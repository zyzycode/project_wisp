"""Exact model preflight, bounded transport and no generation after failed count."""

import asyncio
import json
import sqlite3
from collections.abc import Callable

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from tests.helpers import CONTRACT_FIXTURES, TrackedStream, gemini_completion
from wisp_backend.accounting.contracts import Usage
from wisp_backend.api.dispatch import prepare_job
from wisp_backend.api.schemas.chat import ChatRequest
from wisp_backend.api.schemas.interaction import InteractionChatRequest
from wisp_backend.completion.context import ContextBlock, ContextMessage
from wisp_backend.completion.contracts import InferenceRequest
from wisp_backend.config.settings import AssistantSettings
from wisp_backend.providers.gemini import GeminiProvider

SETTINGS = AssistantSettings(provider="gemini")
REQUEST = InferenceRequest(
    (ContextBlock("current", "dialogue", True, 1000, 100, (ContextMessage("user", "Привет!"),)),), 1024, 16384
)


def test_exact_count_keeps_russian_v7_history_and_counts_the_generated_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    body = json.loads((CONTRACT_FIXTURES / "desktop-backend-v7/request.chat.json").read_bytes())
    body["messages"] = [
        turn
        for _ in range(3)
        for turn in [
            {"role": "user", "content": "Расскажи ещё."},
            {"role": "assistant", "content": ("Я рада тебя видеть. " * 150)[:2000]},
        ]
    ] + [{"role": "user", "content": "Продолжим разговор?"}]
    job = prepare_job(InteractionChatRequest.model_validate(body))
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        if request.url.path.endswith(":countTokens"):
            return httpx.Response(200, json={"totalTokens": 6000})
        return httpx.Response(200, json=gemini_completion())

    def no_estimate(*args: object) -> int:
        pytest.fail("Gemini must not use the byte estimator")

    monkeypatch.setattr("wisp_backend.providers.http_provider.estimate_input", no_estimate)

    async def run() -> None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url="https://mock.invalid") as client:
            result = await GeminiProvider(client, SETTINGS).complete(job.inference, 10)
        assert result.error is None and result.usage == Usage(5, 5, 10)

    asyncio.run(run())
    assert len(calls) == 2
    count_payload = json.loads(calls[0].content)["generateContentRequest"]
    generated = json.loads(calls[1].content)
    assert count_payload == {"model": "models/gemini-3.5-flash-lite", **generated}
    assert generated["generationConfig"]["maxOutputTokens"] == 4096
    assert sum(item["role"] == "model" for item in generated["contents"]) == 3
    assert calls[1].extensions["timeout"]["read"] <= calls[0].extensions["timeout"]["read"]


@pytest.mark.parametrize("tokens,generates", [(15360, True), (15361, False)])
def test_exact_boundary_and_mandatory_overflow(tokens: int, generates: bool) -> None:
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        if request.url.path.endswith(":countTokens"):
            return httpx.Response(200, json={"totalTokens": tokens})
        return httpx.Response(200, json=gemini_completion())

    async def run() -> None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url="https://mock.invalid") as client:
            result = await GeminiProvider(client, SETTINGS).complete(REQUEST, 10)
        assert result.error == (None if generates else "upstream_unavailable")
        if not generates:
            assert result.usage == Usage(0, 0, 0)

    asyncio.run(run())
    assert sum(path.endswith(":countTokens") for path in calls) == 1
    assert sum(path.endswith(":generateContent") for path in calls) == int(generates)


@pytest.mark.parametrize(
    "data",
    [
        {},
        [],
        {"totalTokens": True},
        {"totalTokens": -1},
        {"totalTokens": 1.5},
        {"totalTokens": "12"},
        {"totalTokens": None},
    ],
)
def test_invalid_count_never_generates(data: object) -> None:
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        return httpx.Response(200, json=data)

    async def run() -> None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url="https://mock.invalid") as client:
            result = await GeminiProvider(client, SETTINGS).complete(REQUEST, 10)
        assert result.error == "upstream_unavailable" and result.usage == Usage(0, 0, 0)

    asyncio.run(run())
    assert len(calls) == 1 and calls[0].endswith(":countTokens")


@pytest.mark.parametrize("status", [302, 401, 403, 429, 500])
def test_count_http_failure_is_not_retried_or_followed(status: int) -> None:
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(status, text="private provider detail", headers={"Location": "https://other.invalid"})

    async def run() -> None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url="https://mock.invalid") as client:
            result = await GeminiProvider(client, SETTINGS).complete(REQUEST, 10)
        assert result.error == "upstream_unavailable" and result.usage == Usage(0, 0, 0)

    asyncio.run(run())
    assert len(calls) == 1


@pytest.mark.parametrize(
    "chunk,error,code",
    [
        (b"{", None, "upstream_unavailable"),
        (b"\xff", None, "upstream_unavailable"),
        (b'{"totalTokens":1,"totalTokens":2}', None, "upstream_unavailable"),
        (b"x" * (16 * 1024 + 1), None, "upstream_unavailable"),
        (b"", httpx.ReadTimeout("private"), "upstream_timeout"),
        (b"", httpx.ConnectError("private"), "upstream_unavailable"),
    ],
)
def test_count_stream_is_bounded_and_closed(chunk: bytes, error: Exception | None, code: str) -> None:
    stream = TrackedStream([chunk], error)

    async def run() -> None:
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(lambda _: httpx.Response(200, stream=stream)), base_url="https://mock.invalid"
        ) as client:
            result = await GeminiProvider(client, SETTINGS).complete(REQUEST, 10)
        assert result.error == code and result.usage == Usage(0, 0, 0)
        assert stream.closed and stream.read_count == 1

    asyncio.run(run())


@pytest.mark.parametrize("explicit_cancel", [False, True])
def test_late_count_after_deadline_or_cancel_cannot_generate(explicit_cancel: bool) -> None:
    class LateCount(httpx.AsyncByteStream):
        closed = False

        async def __aiter__(self):
            try:
                await asyncio.sleep(10)
            except asyncio.CancelledError:
                yield b'{"totalTokens":1}'

        async def aclose(self) -> None:
            self.closed = True

    stream = LateCount()
    calls = []

    async def run() -> None:
        entered = asyncio.Event()

        def handler(request: httpx.Request) -> httpx.Response:
            calls.append(request.url.path)
            entered.set()
            return httpx.Response(200, stream=stream)

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url="https://mock.invalid") as client:
            task = asyncio.create_task(
                GeminiProvider(client, SETTINGS).complete(REQUEST, 10 if explicit_cancel else 0.01)
            )
            await entered.wait()
            if explicit_cancel:
                task.cancel()
            result = await task
        assert result.error == "upstream_timeout" and result.usage == Usage(0, 0, 0)

    asyncio.run(run())
    assert stream.closed and len(calls) == 1


def test_count_failure_settles_zero_and_replays_without_more_http(
    app_factory: Callable[..., FastAPI], body: dict
) -> None:
    count_calls = []

    def count(request: httpx.Request) -> httpx.Response:
        count_calls.append(request)
        return httpx.Response(200, json={"totalTokens": False})

    def generation(_: httpx.Request) -> httpx.Response:
        pytest.fail("Invalid count reached generation")

    app = app_factory(generation, count_handler=count, assistants={"default": {"provider": "gemini"}})
    with TestClient(app) as client:
        result = client.post("/v1/chat", json=body)
        assert result.status_code == 503
        assert client.post("/v1/chat", json=body).content == result.content
        with sqlite3.connect(app.state.completion_service.ledger.path) as db:
            assert db.execute("SELECT requests,reserved,confirmed,uncertain FROM days").fetchone() == (1, 0, 0, 0)
    assert len(count_calls) == 1


@pytest.mark.parametrize("mode", ["timeout", "cancel", "shutdown"])
def test_interrupted_preflight_settles_zero_without_late_publication(
    app_factory: Callable[..., FastAPI],
    body: dict,
    mode: str,
) -> None:
    async def run() -> None:
        entered = asyncio.Event()
        calls = []

        class LateCount(httpx.AsyncByteStream):
            closed = False

            async def __aiter__(self):
                entered.set()
                try:
                    await asyncio.Future()
                except asyncio.CancelledError:
                    yield b'{"totalTokens":1}'

            async def aclose(self) -> None:
                self.closed = True

        stream = LateCount()

        def count(request: httpx.Request) -> httpx.Response:
            calls.append(request)
            return httpx.Response(200, stream=stream)

        def generation(_: httpx.Request) -> httpx.Response:
            pytest.fail("Cancelled count reached generation")

        app = app_factory(
            generation,
            count_handler=count,
            assistants={"default": {"provider": "gemini"}},
            request_timeout=0.2 if mode == "timeout" else 10,
        )
        async with app.router.lifespan_context(app):
            service = app.state.completion_service
            job = prepare_job(ChatRequest.model_validate(body))
            task = asyncio.create_task(service.complete(job, "digest", asyncio.get_running_loop().time()))
            await asyncio.wait_for(entered.wait(), 1)
            if mode == "timeout":
                assert (await task).status == 504
            else:
                if mode == "cancel":
                    task.cancel()
                else:
                    await service.close()
                with pytest.raises(asyncio.CancelledError):
                    await task

            async def settled() -> None:
                while service.background:
                    await asyncio.sleep(0)

            await asyncio.wait_for(settled(), 1)
            with sqlite3.connect(service.ledger.path) as db:
                assert db.execute("SELECT requests,reserved,confirmed,uncertain FROM days").fetchone() == (1, 0, 0, 0)
                assert db.execute("SELECT count(*) FROM entries WHERE state='flight'").fetchone() == (0,)
            replay = await service.complete(job, "digest", asyncio.get_running_loop().time())
            assert replay.status == (503 if mode == "shutdown" else 409)
        assert len(calls) == 1 and stream.closed

    asyncio.run(run())
