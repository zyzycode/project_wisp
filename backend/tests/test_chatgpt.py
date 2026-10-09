import asyncio
import json
import time

import httpx
import pytest
from fastapi.testclient import TestClient

from wisp_backend.application import create_app
from wisp_backend.chatgpt_http import PLAN_SCOPE, RESOURCE
from wisp_backend.chatgpt_store import SessionStore
from wisp_backend.config import AssistantSettings, Settings
from tests.test_lifecycle import TrackedStream


def credentials():
    return {"client_id": "oaiapp_test", "subject": "user", "host_id": "urn:uuid:test",
            "access_token": "oauth-secret", "refresh_token": "refresh-secret",
            "scopes": [PLAN_SCOPE, "resource.invoke"], "expires_at": time.time() + 3600, "model": "test-model"}


def completed(text="Привет!"):
    return {"type": "response.completed", "response": {"status": "completed", "output": [
        {"type": "message", "status": "completed", "role": "assistant", "content": [
            {"type": "output_text", "text": json.dumps({"text": text}, ensure_ascii=False)}]}]}}


def sse(value):
    return ("data: " + json.dumps(value, ensure_ascii=False) + "\r\n\r\n").encode()


@pytest.fixture
def chatgpt_client(tmp_path, monkeypatch):
    store = SessionStore(tmp_path / "session.local")
    store.write(credentials())
    monkeypatch.setattr("wisp_backend.chatgpt_store.SessionStore", lambda: store)

    def factory(handler, deadline=10):
        def route(request):
            assert request.headers["authorization"] == "Bearer oauth-secret"
            assert request.url.host == "api.openai.com"
            if request.url.path == "/v1/models":
                return httpx.Response(200, json={"models": [{"slug": "test-model", "display_name": "Test", "visibility": "list"}]})
            assert str(request.url) == RESOURCE + "/responses"
            return handler(request)
        config = Settings(provider="chatgpt", request_timeout=deadline,
                          assistants={"default": AssistantSettings(provider="chatgpt", model="saved")})
        return TestClient(create_app(httpx.MockTransport(route), settings=config))
    return factory


def test_subscription_mapping_and_split_utf8(chatgpt_client, body):
    raw = sse(completed())
    stream = TrackedStream([raw[i:i + 1] for i in range(len(raw))])
    def handler(request):
        payload = json.loads(request.content)
        assert set(payload) == {"model", "store", "stream", "instructions", "input"}
        assert payload["model"] == "test-model"
        assert payload["store"] is False and payload["stream"] is True
        assert "JSON" in payload["instructions"]
        assert all(row["role"] != "system" for row in payload["input"])
        return httpx.Response(200, headers={"content-type": "text/event-stream"}, stream=stream)
    with chatgpt_client(handler) as client:
        result = client.post("/v1/chat", json=body)
        assert result.status_code == 200
        assert result.json() == {"version": 1, "requestId": body["requestId"], "text": "Привет!"}
        upstream = client.app.state.chat_service.providers["chatgpt"].client
    assert stream.closed and upstream.is_closed


@pytest.mark.parametrize("status", [301, 401, 403, 429, 500])
def test_errors_never_retry_or_fallback(chatgpt_client, body, status):
    calls = []
    def handler(request):
        calls.append(request)
        return httpx.Response(status, text="private", headers={"location": "https://other.test"})
    with chatgpt_client(handler) as client:
        result = client.post("/v1/chat", json=body)
    assert result.status_code == 503 and "private" not in result.text
    assert len(calls) == 1


@pytest.mark.parametrize("chunks", [[b"data: {\n\n"], [sse({"type": "response.failed"})],
    [sse({"type": "response.output_text.delta", "delta": "partial"})],
    [sse(completed("x" * 2001))], [b"x" * (256 * 1024 + 1)], [b"data: \xff\n\n"]])
def test_invalid_or_incomplete_stream(chatgpt_client, body, chunks):
    stream = TrackedStream(chunks)
    with chatgpt_client(lambda _: httpx.Response(200, stream=stream, headers={"content-type": "text/event-stream"})) as client:
        assert client.post("/v1/chat", json=body).status_code == 502
    assert stream.closed


@pytest.mark.parametrize("error,status", [(httpx.ConnectError, 503), (httpx.ReadTimeout, 504)])
def test_network_errors(chatgpt_client, body, error, status):
    def handler(_):
        raise error("private")
    with chatgpt_client(handler) as client:
        result = client.post("/v1/chat", json=body)
    assert result.status_code == status and "private" not in result.text


def test_deadline_closes_stream_and_discards_late_result(chatgpt_client, body):
    class SlowStream(TrackedStream):
        async def __aiter__(self):
            await asyncio.sleep(30)
            yield sse(completed())
    stream = SlowStream([])
    with chatgpt_client(lambda _: httpx.Response(200, stream=stream, headers={"content-type": "text/event-stream"}), .02) as client:
        assert client.post("/v1/chat", json=body).status_code == 504
    assert stream.closed


def test_touch_uses_subscription_adapter(chatgpt_client, body):
    body.pop("messages")
    body["event"] = {"type": "user_touch", "variant": "stroke"}
    with chatgpt_client(lambda _: httpx.Response(200, content=sse(completed()), headers={"content-type": "text/event-stream"})) as client:
        assert client.post("/v1/touch", json=body).status_code == 200


def test_subscription_config_ignores_paid_keys(monkeypatch):
    monkeypatch.setenv("WISP_AI_PROVIDER", "chatgpt")
    monkeypatch.setenv("GROQ_API_KEY", "paid-secret")
    monkeypatch.setenv("ASSISTANTS_JSON", "invalid ignored legacy profiles")
    config = Settings.from_env()
    assert config.api_key is None
    assert config.assistants["default"].provider == "chatgpt"
