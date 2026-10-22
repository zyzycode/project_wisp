"""Observation payload remains volatile under the existing shared ledger policy."""

import asyncio
import json
import sqlite3
from collections.abc import Callable
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from tests.api.test_observation_validation import fixture
from tests.helpers import Clock, gemini_completion
from wisp_backend.accounting.policy import ID_TTL
from wisp_backend.accounting.replay import CACHE_TTL
from wisp_backend.api.endpoints import OBSERVATION


@pytest.mark.parametrize("provider", ["groq", "gemini"])
def test_response_ttl_restart_and_durable_records_never_store_metadata(
    app_factory: Callable[..., FastAPI],
    completion: Callable[..., dict],
    provider: str,
    caplog: pytest.LogCaptureFixture,
) -> None:
    async def run() -> None:
        clock = Clock()
        calls = 0

        def upstream(request: httpx.Request) -> httpx.Response:
            nonlocal calls
            calls += 1
            reply = {"text": "PRIVATE_GENERATED_REPLY"}
            return httpx.Response(200, json=completion(reply) if provider == "groq" else gemini_completion(reply))

        app = app_factory(upstream, assistants={"default": {"provider": provider}})
        request = fixture("request.hostile-title.json")
        request["observation"]["appName"] = "PRIVATE_EXECUTABLE"
        request["character"]["personality"]["aiSelfConcept"] = "PRIVATE_CHARACTER"
        request2 = {**request, "requestId": str(uuid4())}
        async with app.router.lifespan_context(app):
            ledger = app.state.completion_service.ledger
            ledger.clock = clock
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                first = await client.post(OBSERVATION.path, json=request)
                assert first.status_code == 200
                clock.now += CACHE_TTL - 0.001
                assert (await client.post(OBSERVATION.path, json=request)).content == first.content
                clock.now += 0.001
                assert (await client.post(OBSERVATION.path, json=request)).status_code == 409
                assert (await client.post(OBSERVATION.path, json=request2)).status_code == 200
            with sqlite3.connect(ledger.path) as db:
                dump = "\n".join(db.iterdump())
                assert db.execute("SELECT requests,reserved FROM days").fetchone() == (2, 0)
            assert all(
                marker not in dump
                for marker in ["PRIVATE_TITLE", "PRIVATE_EXECUTABLE", "PRIVATE_CHARACTER", "PRIVATE_GENERATED_REPLY"]
            )
        # A new process can see durable IDs but cannot recover volatile response bytes.
        restarted = app_factory(upstream, ledger_path=ledger.path, assistants={"default": {"provider": provider}})
        async with restarted.router.lifespan_context(restarted):
            reopened = restarted.state.completion_service.ledger
            reopened.clock = clock
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=restarted), base_url="http://test"
            ) as client:
                assert (await client.post(OBSERVATION.path, json=request2)).status_code == 409
            clock.now += ID_TTL
            await reopened.maintain()
            with sqlite3.connect(reopened.path) as db:
                assert db.execute("SELECT count(*) FROM entries").fetchone()[0] == 0
                assert db.execute("SELECT requests FROM days").fetchone()[0] == 2
        assert calls == 2

    asyncio.run(run())
    assert "PRIVATE_" not in caplog.text


@pytest.mark.parametrize("provider", ["groq", "gemini"])
def test_response_stream_closed_on_observation_deadline(
    app_factory: Callable[..., FastAPI],
    provider: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from dataclasses import replace

    from wisp_backend.completion.policies import POLICIES, Scenario

    monkeypatch.setitem(POLICIES, Scenario.OBSERVATION, replace(POLICIES[Scenario.OBSERVATION], timeout=0.2))

    async def run() -> None:
        entered, closed = asyncio.Event(), asyncio.Event()

        class Stream(httpx.AsyncByteStream):
            async def __aiter__(self):
                entered.set()
                yield b"{"
                await asyncio.Future()

            async def aclose(self) -> None:
                closed.set()

        calls = 0

        def upstream(request: httpx.Request) -> httpx.Response:
            nonlocal calls
            calls += 1
            return httpx.Response(200, stream=Stream())

        app = app_factory(upstream, assistants={"default": {"provider": provider}})
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                result = await client.post(OBSERVATION.path, json=fixture("request.valid.json"))
                assert entered.is_set() and result.status_code == 504
                await asyncio.wait_for(closed.wait(), 1)
        assert calls == 1

    asyncio.run(run())


def test_exact_request_cap_and_documented_statuses(
    app_factory: Callable[..., FastAPI],
    completion: Callable[..., dict],
) -> None:
    from fastapi.testclient import TestClient

    with TestClient(app_factory(lambda _: httpx.Response(200, json=completion()))) as client:
        raw = json.dumps(fixture("request.valid.json")).encode()
        raw += b" " * (32768 - len(raw))
        assert (
            client.post(OBSERVATION.path, content=raw, headers={"content-type": "application/json"}).status_code == 200
        )
        responses = client.get("/openapi.json").json()["paths"][OBSERVATION.path]["post"]["responses"]
        assert set(responses) == {"200", "400", "409", "413", "429", "502", "503", "504"}


@pytest.mark.parametrize("shutdown", [False, True])
def test_late_result_after_cancel_or_shutdown_never_publishes(
    app_factory: Callable[..., FastAPI],
    shutdown: bool,
) -> None:
    from wisp_backend.accounting.contracts import Usage
    from wisp_backend.api.dispatch import prepare_job
    from wisp_backend.api.schemas.observation import ObservationRequest
    from wisp_backend.completion.contracts import InferenceRequest, ProviderResult
    from wisp_backend.errors import ServiceError

    async def run() -> None:
        entered, cancelled, release = asyncio.Event(), asyncio.Event(), asyncio.Event()

        class LateProvider:
            async def complete(self, request: InferenceRequest, timeout: float) -> ProviderResult:
                entered.set()
                try:
                    await asyncio.Future()
                except asyncio.CancelledError:
                    cancelled.set()
                    await release.wait()
                    return ProviderResult(json.dumps({"text": "PRIVATE_LATE_REPLY"}), Usage(2, 3, 5))

        app = app_factory(lambda _: pytest.fail("unexpected upstream"))
        async with app.router.lifespan_context(app):
            service = app.state.completion_service
            service.provider = LateProvider()
            request = ObservationRequest.model_validate(fixture("request.valid.json"))
            task = asyncio.create_task(
                service.complete(prepare_job(request), "digest", asyncio.get_running_loop().time())
            )
            await asyncio.wait_for(entered.wait(), 1)
            closer = asyncio.create_task(service.close()) if shutdown else None
            if not shutdown:
                task.cancel()
            await asyncio.wait_for(cancelled.wait(), 1)
            release.set()
            with pytest.raises(asyncio.CancelledError):
                await task
            if closer is not None:
                await asyncio.wait_for(closer, 1)

            async def drain() -> None:
                while service.background:
                    await asyncio.sleep(0)

            await asyncio.wait_for(drain(), 1)
            with pytest.raises(ServiceError, match="request_conflict"):
                await service.ledger.admit(request.requestId, "digest")
            with sqlite3.connect(service.ledger.path) as db:
                assert db.execute("SELECT requests,reserved,confirmed,uncertain FROM days").fetchone() == (1, 0, 5, 0)

    asyncio.run(run())
