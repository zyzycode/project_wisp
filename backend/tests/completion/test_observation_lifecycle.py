import asyncio
import json
import sqlite3
from collections.abc import Callable
from dataclasses import replace
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from tests.helpers import CONTRACT_FIXTURES, gemini_completion, touch_body
from wisp_backend.accounting.contracts import Usage
from wisp_backend.api.boundary import CompletionBoundary
from wisp_backend.api.dispatch import prepare_job
from wisp_backend.api.schemas.observation import ObservationRequest
from wisp_backend.completion.contracts import InferenceRequest, ProviderResult
from wisp_backend.completion.policies import POLICIES, Scenario
from wisp_backend.config.profiles import PROFILES

FIXTURES = CONTRACT_FIXTURES / "desktop-backend-v6"


def fixture(name: str) -> dict:
    return json.loads((FIXTURES / name).read_bytes())


def upstream_reply(provider: str, completion: Callable[..., dict]) -> dict:
    if provider == "gemini":
        return gemini_completion(
            {"text": "observation"}, usage={"promptTokenCount": 1, "candidatesTokenCount": 2, "totalTokenCount": 3}
        )
    return completion({"text": "observation"}, usage={"prompt_tokens": 1, "completion_tokens": 2, "total_tokens": 3})


@pytest.mark.parametrize("provider", ["groq", "gemini"])
def test_v6_replay_and_cross_endpoint_namespace_settle_once(
    app_factory: Callable[..., FastAPI],
    body: dict,
    completion: Callable[..., dict],
    provider: str,
) -> None:
    async def run() -> None:
        calls: list[httpx.Request] = []

        def upstream(request: httpx.Request) -> httpx.Response:
            calls.append(request)
            return httpx.Response(200, json=upstream_reply(provider, completion))

        app = app_factory(upstream, assistants={"default": {"provider": provider}})
        observation = fixture("request.valid.json")
        candidates = [
            ("/v1/chat", body),
            ("/v1/touch", touch_body(body)),
            ("/v3/chat", json.loads((CONTRACT_FIXTURES / "desktop-backend-v3/request.chat.json").read_bytes())),
            ("/v3/events", json.loads((CONTRACT_FIXTURES / "desktop-backend-v3/request.game.json").read_bytes())),
            (
                "/v2/chat",
                {
                    **body,
                    "version": 2,
                    "memory": json.loads((CONTRACT_FIXTURES / "desktop-backend-v3/request.game.json").read_bytes())[
                        "memory"
                    ],
                },
            ),
            ("/v5/chat", json.loads((CONTRACT_FIXTURES / "desktop-backend-v5/request.chat-summary.json").read_bytes())),
            ("/v5/summary", json.loads((CONTRACT_FIXTURES / "desktop-backend-v5/request.summary.json").read_bytes())),
        ]
        async with app.router.lifespan_context(app):
            service = app.state.completion_service
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                first = await client.post("/v6/observation", json=observation)
                assert first.status_code == 200 and first.json()["version"] == 6
                for route, candidate in candidates:
                    conflict = await client.post(route, json={**candidate, "requestId": observation["requestId"]})
                    assert conflict.status_code == 409
                    assert conflict.json()["error"]["code"] == "request_conflict"
                    assert conflict.json()["version"] == candidate["version"]
                    assert (await client.post(route, json={**candidate, "requestId": str(uuid4())})).status_code == 200
                assert (await client.post("/v6/observation", json=observation)).content == first.content
                changed = {**observation, "locale": "en"}
                assert (await client.post("/v6/observation", json=changed)).status_code == 409
            with sqlite3.connect(service.ledger.path) as db:
                assert db.execute("SELECT requests,reserved,confirmed,uncertain FROM days").fetchone() == (8, 0, 24, 0)
        assert len(calls) == 8

    asyncio.run(run())


@pytest.mark.parametrize("provider", ["groq", "gemini"])
def test_v6_inflight_duplicate_and_conflict_never_dispatch_again(
    app_factory: Callable[..., FastAPI],
    completion: Callable[..., dict],
    provider: str,
) -> None:
    async def run() -> None:
        entered, release = asyncio.Event(), asyncio.Event()
        calls: list[httpx.Request] = []

        async def upstream(request: httpx.Request) -> httpx.Response:
            calls.append(request)
            entered.set()
            await release.wait()
            return httpx.Response(200, json=upstream_reply(provider, completion))

        app = app_factory(upstream, assistants={"default": {"provider": provider}})
        observation = fixture("request.valid.json")
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                first = asyncio.create_task(client.post("/v6/observation", json=observation))
                await asyncio.wait_for(entered.wait(), 1)
                second = None
                try:
                    duplicate = await client.post("/v6/observation", json=observation)
                    assert duplicate.status_code == 409 and duplicate.json()["error"]["code"] == "request_in_progress"
                    conflict = await client.post(
                        "/v5/chat",
                        json={
                            **json.loads((CONTRACT_FIXTURES / "desktop-backend-v5/request.chat.json").read_bytes()),
                            "requestId": observation["requestId"],
                        },
                    )
                    assert conflict.status_code == 409 and conflict.json()["error"]["code"] == "request_conflict"
                    changed = await client.post("/v6/observation", json={**observation, "locale": "en"})
                    assert changed.status_code == 409 and changed.json()["error"]["code"] == "request_conflict"
                    second = asyncio.create_task(
                        client.post("/v6/observation", json={**observation, "requestId": str(uuid4())})
                    )

                    async def wait_dispatch() -> None:
                        while len(calls) < 2:
                            await asyncio.sleep(0)

                    await asyncio.wait_for(wait_dispatch(), 1)
                finally:
                    release.set()
                    assert (await first).status_code == 200
                    if second is not None:
                        assert (await second).status_code == 200
            with sqlite3.connect(app.state.completion_service.ledger.path) as db:
                assert db.execute("SELECT requests,reserved,confirmed,uncertain FROM days").fetchone() == (2, 0, 6, 0)
        assert len(calls) == 2

    asyncio.run(run())


@pytest.mark.parametrize("provider", ["groq", "gemini"])
@pytest.mark.parametrize("shutdown", [False, True])
@pytest.mark.parametrize("route,filename", [("/v6/observation", "request.valid.json")])
def test_v6_disconnect_and_shutdown_close_provider_and_release_capacity(
    app_factory: Callable[..., FastAPI],
    provider: str,
    shutdown: bool,
    route: str,
    filename: str,
) -> None:
    async def run() -> None:
        entered, cancelled = asyncio.Event(), asyncio.Event()

        async def upstream(request: httpx.Request) -> httpx.Response:
            entered.set()
            try:
                await asyncio.Future()
            finally:
                cancelled.set()

        app = app_factory(upstream, assistants={"default": {"provider": provider}})
        sent: list[dict] = []
        async with app.router.lifespan_context(app):
            service = app.state.completion_service
            delivered = False

            async def receive() -> dict:
                nonlocal delivered
                if not delivered:
                    delivered = True
                    return {"type": "http.request", "body": (FIXTURES / filename).read_bytes(), "more_body": False}
                await entered.wait()
                if shutdown:
                    await asyncio.Future()
                return {"type": "http.disconnect"}

            async def send(value: dict) -> None:
                sent.append(value)

            scope = {
                "type": "http",
                "asgi": {"version": "3.0"},
                "path": route,
                "method": "POST",
                "headers": [(b"content-type", b"application/json")],
                "query_string": b"",
                "scheme": "http",
                "server": ("test", 80),
                "client": ("127.0.0.1", 123),
                "http_version": "1.1",
            }
            task = asyncio.create_task(app(scope, receive, send))
            await asyncio.wait_for(entered.wait(), 1)
            if shutdown:
                await service.close()
            await asyncio.wait_for(task, 1)
            await asyncio.wait_for(cancelled.wait(), 1)
            assert not sent
            with sqlite3.connect(service.ledger.path) as db:
                assert db.execute("SELECT requests,reserved,uncertain FROM days").fetchone() == (
                    1,
                    0,
                    PROFILES[provider].reservation,
                )
                assert db.execute("SELECT count(*) FROM entries WHERE state='flight'").fetchone()[0] == 0

    asyncio.run(run())


@pytest.mark.parametrize("provider", ["groq", "gemini"])
def test_observation_late_usage_refines_once_without_replaying_success(
    app_factory: Callable[..., FastAPI],
    monkeypatch: pytest.MonkeyPatch,
    provider: str,
) -> None:
    monkeypatch.setitem(POLICIES, Scenario.OBSERVATION, replace(POLICIES[Scenario.OBSERVATION], timeout=0.2))

    async def run() -> None:
        release, entered = asyncio.Event(), asyncio.Event()
        calls = 0

        class LateProvider:
            async def complete(self, request: InferenceRequest, timeout: float) -> ProviderResult:
                nonlocal calls
                calls += 1
                entered.set()
                assert 0 < timeout <= 0.2 and request.max_output_tokens == 1024 and request.context_window == 16384
                try:
                    await asyncio.Future()
                except asyncio.CancelledError:
                    await release.wait()
                    return ProviderResult(json.dumps({"text": "late"}), Usage(2, 3, 5))

        app = app_factory(lambda _: pytest.fail("unexpected upstream"), assistants={"default": {"provider": provider}})
        async with app.router.lifespan_context(app):
            service = app.state.completion_service
            service.provider = LateProvider()
            request = ObservationRequest.model_validate(fixture("request.valid.json"))
            first = await service.complete(
                prepare_job(request), "observation-digest", asyncio.get_running_loop().time()
            )
            assert first.status == 504 and json.loads(first.body)["version"] == 6
            assert entered.is_set()
            release.set()

            async def drain() -> None:
                while service.background:
                    await asyncio.sleep(0)

            await asyncio.wait_for(drain(), 1)
            for _ in range(2):
                assert (
                    await service.complete(
                        prepare_job(request), "observation-digest", asyncio.get_running_loop().time()
                    )
                ).status == 409
            assert calls == 1
            with sqlite3.connect(service.ledger.path) as db:
                assert db.execute("SELECT requests,reserved,confirmed,uncertain FROM days").fetchone() == (1, 0, 5, 0)

    asyncio.run(run())


@pytest.mark.parametrize("provider", ["groq", "gemini"])
def test_observation_cancel_during_settlement_never_caches_success(
    app_factory: Callable[..., FastAPI],
    completion: Callable[..., dict],
    provider: str,
) -> None:
    async def run() -> None:
        entered, release = asyncio.Event(), asyncio.Event()
        app = app_factory(
            lambda _: httpx.Response(200, json=upstream_reply(provider, completion)),
            assistants={"default": {"provider": provider}},
        )
        async with app.router.lifespan_context(app):
            service = app.state.completion_service
            original = service.ledger.settle

            async def slow(*args: object) -> None:
                entered.set()
                await release.wait()
                await original(*args)

            service.ledger.settle = slow
            request = ObservationRequest.model_validate(fixture("request.valid.json"))
            task = asyncio.create_task(
                service.complete(prepare_job(request), "digest", asyncio.get_running_loop().time())
            )
            await asyncio.wait_for(entered.wait(), 1)
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
            release.set()

            async def drain() -> None:
                while service.background:
                    await asyncio.sleep(0)

            await asyncio.wait_for(drain(), 1)
            assert (
                await service.complete(prepare_job(request), "digest", asyncio.get_running_loop().time())
            ).status == 409
            with sqlite3.connect(service.ledger.path) as db:
                assert db.execute("SELECT requests,reserved,confirmed,uncertain FROM days").fetchone() == (1, 0, 3, 0)

    asyncio.run(run())


@pytest.mark.parametrize("route", ["/v6/observation"])
def test_slow_v6_body_never_enters_completion(route: str, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("wisp_backend.api.endpoints.EVENT_BODY_TIMEOUT", 0.01)

    async def run() -> None:
        sent: list[dict] = []

        async def receive() -> dict:
            await asyncio.Future()

        async def send(value: dict) -> None:
            sent.append(value)

        async def downstream(*args: object) -> None:
            pytest.fail("slow observation body admitted")

        await CompletionBoundary(downstream)(
            {"type": "http", "path": route, "method": "POST", "headers": [(b"content-type", b"application/json")]},
            receive,
            send,
        )
        assert sent[0]["status"] == 400
        assert json.loads(sent[1]["body"]) == {"version": 6, "requestId": None, "error": {"code": "invalid_request"}}

    asyncio.run(run())
