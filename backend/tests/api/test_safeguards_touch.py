"""Both v1 routes share admission and cancellation without sanitizing touch hints."""

import asyncio
from uuid import uuid4

import httpx
import pytest
from tests.helpers import touch_body
from wisp_backend.api.boundary import CompletionBoundary


def test_duplicate_and_cross_route_do_not_dispatch_twice(client_factory, body, chat_completion):
    calls = []

    def upstream(request):
        calls.append(request)
        return httpx.Response(200, json=chat_completion())

    with client_factory(upstream) as client:
        first = client.post("/v1/chat", json=body)
        assert client.post("/v1/chat", json=body).content == first.content
        assert len(calls) == 1
        assert client.post("/v1/touch", json=touch_body(body)).status_code == 409
        assert len(calls) == 1


def test_touch_does_not_exhaust_chat_rate_budget(client_factory, body, chat_completion):
    with client_factory(lambda _: httpx.Response(200, json=chat_completion())) as client:
        for _ in range(12):
            request = touch_body(body) | {"requestId": str(uuid4())}
            assert client.post("/v1/touch", json=request).status_code == 200
        response = client.post("/v1/chat", json=body)
        assert response.status_code == 200


@pytest.mark.parametrize("extra", [{"decision": None}, {"decision": {"behavior": "invalid"}}, {"memoryCandidates": []}])
def test_touch_never_sanitizes_extra_model_keys(client_factory, body, chat_completion, extra):
    with client_factory(lambda _: httpx.Response(200, json=chat_completion({"text": "OK", **extra}))) as client:
        assert client.post("/v1/touch", json=touch_body(body)).status_code == 502


@pytest.mark.parametrize("path", ["/v1/chat", "/v1/touch"])
def test_body_timeout_before_dispatch(monkeypatch, path):
    async def scenario():
        sent = []

        async def app(scope, receive, send):
            pytest.fail("No application dispatch for slow body")

        async def receive():
            await asyncio.sleep(0.1)
            return {"type": "http.request", "body": b"{}"}

        async def send(message):
            sent.append(message)

        monkeypatch.setattr("wisp_backend.api.endpoints.BODY_TIMEOUT", 0.01, raising=False)
        await CompletionBoundary(app)(
            {"type": "http", "path": path, "method": "POST", "headers": [(b"content-type", b"application/json")]},
            receive,
            send,
        )
        assert sent[0]["status"] == 400

    asyncio.run(scenario())


@pytest.mark.parametrize("path", ["/v1/chat", "/v1/touch"])
def test_disconnect_cancels_application(path):
    async def scenario():
        cancelled = []
        delivered = asyncio.Event()
        first = True

        async def receive():
            nonlocal first
            if first:
                first = False
                return {"type": "http.request", "body": b"{}"}
            await delivered.wait()
            return {"type": "http.disconnect"}

        async def app(scope, receive, send):
            await receive()
            delivered.set()
            try:
                await asyncio.sleep(0.1)
            except asyncio.CancelledError:
                cancelled.append(True)
                raise

        await CompletionBoundary(app)(
            {"type": "http", "path": path, "method": "POST", "headers": [(b"content-type", b"application/json")]},
            receive,
            None,
        )
        assert cancelled == [True]

    asyncio.run(scenario())


@pytest.mark.parametrize("first_touch", [False, True])
def test_touch_and_chat_allow_new_ids(app_factory, body, chat_completion, first_touch):
    from fastapi.testclient import TestClient

    app = app_factory(lambda _: httpx.Response(200, json=chat_completion()))
    first_path, second_path = ("/v1/touch", "/v1/chat") if first_touch else ("/v1/chat", "/v1/touch")
    first_body = touch_body(body) if first_touch else body
    second_body = body if first_touch else touch_body(body)
    with TestClient(app) as client:
        assert client.post(first_path, json=first_body).status_code == 200
        assert client.post(second_path, json=second_body).status_code == 409
        response = client.post(second_path, json=second_body | {"requestId": str(uuid4())})
        assert response.status_code == 200


@pytest.mark.parametrize("path", ["/v1/chat", "/v1/touch"])
def test_body_only_digest_is_never_replayed(app_factory, body, path):
    import hashlib
    import json

    from wisp_backend.accounting.contracts import Usage
    from wisp_backend.outcomes import Outcome

    async def run():
        app = app_factory(lambda _: pytest.fail("legacy request dispatched"))
        request = touch_body(body) if path == "/v1/touch" else body
        raw = json.dumps(request).encode()
        digest = hashlib.sha256(raw).hexdigest()
        async with app.router.lifespan_context(app):
            ledger = app.state.completion_service.ledger
            await ledger.admit(body["requestId"], digest)
            outcome = Outcome(200, json.dumps({"version": 1, "requestId": body["requestId"], "text": "old"}).encode())
            await ledger.settle(body["requestId"], Usage(1, 1, 2), outcome)
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                response = await client.post(path, content=raw, headers={"content-type": "application/json"})
                assert response.status_code == 409

    asyncio.run(run())


@pytest.mark.parametrize("path", ["/v1/chat", "/v1/touch"])
def test_exact_body_deadline_rejects_late_receive(monkeypatch, path):
    import time

    async def run():
        sent = []

        async def receive():
            time.sleep(0.03)
            return {"type": "http.request", "body": b"{}"}

        async def downstream(*args):
            pytest.fail("late body dispatched")

        async def send(value):
            sent.append(value)

        monkeypatch.setattr("wisp_backend.api.endpoints.BODY_TIMEOUT", 0.01)
        await CompletionBoundary(downstream)(
            {"type": "http", "path": path, "method": "POST", "headers": [(b"content-type", b"application/json")]},
            receive,
            send,
        )
        assert sent[0]["status"] == 400

    asyncio.run(run())
