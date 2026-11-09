"""Shared singleflight, deadline, disconnect and noncached late settlement."""

import asyncio
import json
import sqlite3
from dataclasses import replace
from typing import Any
from uuid import uuid4

import httpx
import pytest
from tests.api.test_screen_observation import AUTH, PATH, evidence, managed, request_body
from wisp_backend.api.boundary import CompletionBoundary
from wisp_backend.api.endpoints import ENDPOINTS, SCREEN_OBSERVATION
from wisp_backend.api.routes import screen_observation as route
from wisp_backend.api.schemas.screen_observation import ScreenObservationRequest
from wisp_backend.api.screen_observation import prepare_screen_job
from wisp_backend.providers import screen_observation as vision
from wisp_backend.providers.context_budget import estimate_input


def test_reviewed_image_budget_excludes_encoded_bytes_but_keeps_full_template() -> None:
    body = ScreenObservationRequest.model_validate(request_body())
    inference = prepare_screen_job(body).inference
    for width, height, expected in [(32, 32, 2), (1024, 1024, 1229), (33, 32, 3)]:
        sample = replace(inference, width=width, height=height)
        text = estimate_input(vision.vision_payload(sample, include_image=False), 2)
        assert vision.estimate_vision_input(sample) == text + expected
        huge = replace(sample, image_base64="A" * 349528)
        assert vision.estimate_vision_input(huge) == vision.estimate_vision_input(sample)


def test_context_overflow_rejected_before_admission(tmp_path: Any, monkeypatch: Any) -> None:
    from fastapi.testclient import TestClient

    monkeypatch.setattr(vision, "estimate_vision_input", lambda _: 16384)
    app = managed(tmp_path, lambda _: pytest.fail("context overflow dispatched"))
    with TestClient(app) as client:
        assert client.post(PATH, headers=AUTH, json=request_body()).status_code == 503
        with sqlite3.connect(tmp_path / "ledger.sqlite") as db:
            assert db.execute("SELECT count(*) FROM entries").fetchone()[0] == 0


@pytest.mark.parametrize("first_route", [PATH, "/v1/chat"])
def test_shared_singleflight_has_no_queue_or_duplicate_admission(
    tmp_path: Any,
    completion: Any,
    body: Any,
    first_route: str,
) -> None:
    async def run() -> None:
        entered, release = asyncio.Event(), asyncio.Event()
        calls = []

        async def provider(request: httpx.Request) -> httpx.Response:
            calls.append(request)
            entered.set()
            await release.wait()
            result = (
                evidence()
                if first_route == PATH
                else {
                    "text": "Hello",
                    "appraisal": {"category": "neutral", "intensity": "low", "confidence": "clear"},
                }
            )
            return httpx.Response(200, json=completion(result))

        guard = managed(tmp_path, provider)
        app = guard.app
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=guard), base_url="http://test") as client:
                source = request_body() if first_route == PATH else body
                pending = asyncio.create_task(client.post(first_route, headers=AUTH, json=source))
                await asyncio.wait_for(entered.wait(), 2)
                try:
                    assert (await client.post(PATH, headers=AUTH, json=request_body())).status_code == 409
                    other = dict(body, requestId=str(uuid4()))
                    if first_route == PATH:
                        assert (await client.post("/v1/chat", headers=AUTH, json=other)).status_code == 409
                        changed = dict(request_body(), locale="en")
                        reply = await client.post(PATH, headers=AUTH, json=changed)
                        assert reply.json()["error"]["code"] == "request_conflict"
                finally:
                    release.set()
                    assert (await pending).status_code == 200
            with sqlite3.connect(tmp_path / "ledger.sqlite") as db:
                assert db.execute("SELECT count(*) FROM entries").fetchone()[0] == 1
        assert len(calls) == 1

    asyncio.run(run())


@pytest.mark.parametrize("shutdown", [False, True])
def test_disconnect_and_shutdown_cancel_provider_without_cache(tmp_path: Any, shutdown: bool) -> None:
    async def run() -> None:
        entered, cancelled = asyncio.Event(), asyncio.Event()

        async def provider(_: httpx.Request) -> httpx.Response:
            entered.set()
            try:
                await asyncio.Future()
            finally:
                cancelled.set()

        guard = managed(tmp_path, provider)
        app = guard.app
        sent = []
        async with app.router.lifespan_context(app):
            service = app.state.completion_service
            delivered = False

            async def receive() -> dict[str, Any]:
                nonlocal delivered
                if not delivered:
                    delivered = True
                    return {"type": "http.request", "body": json.dumps(request_body()).encode(), "more_body": False}
                await entered.wait()
                if shutdown:
                    await asyncio.Future()
                return {"type": "http.disconnect"}

            async def send(message: dict[str, Any]) -> None:
                sent.append(message)

            scope = {
                "type": "http",
                "asgi": {"version": "3.0"},
                "path": PATH,
                "method": "POST",
                "headers": [(b"content-type", b"application/json"), (b"authorization", AUTH["Authorization"].encode())],
                "query_string": b"",
                "scheme": "http",
                "server": ("test", 80),
                "client": ("127.0.0.1", 123),
                "http_version": "1.1",
            }
            task = asyncio.create_task(guard(scope, receive, send))
            await asyncio.wait_for(entered.wait(), 2)
            if shutdown:
                await service.close()
            await asyncio.wait_for(task, 2)
            await asyncio.wait_for(cancelled.wait(), 2)
            assert not sent and not service.ledger.cache._entries
            assert not service.exclusive_active and not service.active_keys
            with sqlite3.connect(tmp_path / "ledger.sqlite") as db:
                assert db.execute("SELECT count(*) FROM entries WHERE state='flight'").fetchone()[0] == 0

    asyncio.run(run())


def test_absolute_provider_deadline_closes_call(tmp_path: Any, monkeypatch: Any) -> None:
    from fastapi.testclient import TestClient

    original = route.prepare_screen_job
    monkeypatch.setattr(route, "prepare_screen_job", lambda b: replace(original(b), timeout=0.2))
    cancelled = []

    async def provider(_: httpx.Request) -> httpx.Response:
        try:
            await asyncio.Future()
        finally:
            cancelled.append(True)

    with TestClient(managed(tmp_path, provider)) as client:
        reply = client.post(PATH, headers=AUTH, json=request_body())
        assert reply.status_code == 504
    assert cancelled == [True]


def test_screen_body_deadline_precedes_framework_parse(monkeypatch: Any) -> None:
    async def run() -> None:
        async def never_called(*_: Any) -> None:
            pytest.fail("slow body reached framework")

        async def receive() -> dict[str, Any]:
            await asyncio.sleep(0.1)
            return {"type": "http.request", "body": b"{}", "more_body": False}

        sent = []

        async def send(message: dict[str, Any]) -> None:
            sent.append(message)

        monkeypatch.setitem(ENDPOINTS, PATH, replace(SCREEN_OBSERVATION, body_timeout_override=0.02))
        scope = {"type": "http", "path": PATH, "method": "POST", "headers": [(b"content-type", b"application/json")]}
        await CompletionBoundary(never_called)(scope, receive, send)
        assert sent[0]["status"] == 400

    asyncio.run(run())
