"""Mocked native Gemini boundary, all public routes and resource ownership."""

import asyncio
import json
import sqlite3

from fastapi.testclient import TestClient
import httpx
import pytest

from tests.helpers import CONTRACT_FIXTURES
from tests.helpers import TrackedStream
from tests.helpers import gemini_completion
from wisp_backend.config.profiles import PROFILES


FIXTURES = CONTRACT_FIXTURES
PROFILE = {"default": {"provider": "gemini"}}
RESERVATION = PROFILES["gemini"].reservation


@pytest.mark.parametrize("route,fixture,cap", [
    ("/v1/chat", "desktop-backend-v1/request.valid.json", 4096),
    ("/v1/touch", "desktop-backend-v1/request.touch.json", 4096),
    ("/v2/chat", "desktop-backend-v2/request.valid.json", 4096),
    ("/v3/chat", "desktop-backend-v3/request.chat.json", 4096),
    ("/v3/events", "desktop-backend-v3/request.game.json", 1024),
    ("/v3/events", "desktop-backend-v3/request.social.json", 1024),
])
def test_all_routes_translate_and_account(app_factory, route, fixture, cap):
    calls = []
    body = json.loads((FIXTURES / fixture).read_text(encoding="utf-8"))
    def handler(request):
        calls.append(request)
        assert str(request.url) == "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent"
        assert request.headers["x-goog-api-key"] == "test-key"
        assert "authorization" not in request.headers
        payload = json.loads(request.content)
        assert payload["systemInstruction"]["parts"][0]["text"]
        assert all(message["role"] in ("user", "model") for message in payload["contents"])
        assert payload["generationConfig"] == {"responseMimeType": "application/json", "maxOutputTokens": cap,
                                                "candidateCount": 1, "thinkingConfig": {"thinkingLevel": "minimal"}}
        assert "tools" not in payload and "safetySettings" not in payload
        return httpx.Response(200, json=gemini_completion())
    app = app_factory(handler, assistants=PROFILE)
    with TestClient(app) as client:
        upstream = app.state.completion_service.provider.client
        response = client.post(route, json=body)
        assert response.status_code == 200, response.text
        assert response.json() == {"version": body["version"], "requestId": body["requestId"], "text": "Hello"}
        assert client.post(route, json=body).json() == response.json()
        assert len(calls) == 1
        with sqlite3.connect(app.state.completion_service.ledger.path) as db:
            assert db.execute("SELECT reserved,confirmed,prompt,completion FROM days").fetchone() == (0, 10, 5, 5)
    assert upstream.is_closed


@pytest.mark.parametrize("status", [401, 403, 429, 500, 302])
def test_provider_errors_are_safe_and_never_retried(app_factory, body, status):
    calls = []
    def handler(request):
        calls.append(request)
        return httpx.Response(status, text="private provider detail", headers={"location": "https://example.com/"})
    app = app_factory(handler, assistants=PROFILE)
    with TestClient(app) as client:
        response = client.post("/v1/chat", json=body)
        assert response.status_code == 503
        assert response.json()["error"]["code"] == "upstream_unavailable"
        assert "private" not in response.text
        assert len(calls) == 1


@pytest.mark.parametrize("kind", ["bad-json", "blocked", "truncated", "bad-text", "non-text", "bad-envelope"])
def test_invalid_model_output_retains_known_usage(app_factory, body, kind):
    data = gemini_completion()
    candidate = data["candidates"][0]
    if kind == "bad-json":
        candidate["content"]["parts"][0]["text"] = "{"
    elif kind == "blocked":
        candidate["finishReason"] = "SAFETY"
    elif kind == "truncated":
        candidate["finishReason"] = "MAX_TOKENS"
    elif kind == "bad-text":
        candidate["content"]["parts"][0]["text"] = '{"text":""}'
    elif kind == "non-text":
        candidate["content"]["parts"] = [{"functionCall": {"name": "ignored"}}]
    else:
        data["candidates"] = None
    app = app_factory(lambda _: httpx.Response(200, json=data), assistants=PROFILE)
    with TestClient(app) as client:
        assert client.post("/v1/chat", json=body).status_code == 502
        with sqlite3.connect(app.state.completion_service.ledger.path) as db:
            assert db.execute("SELECT confirmed,uncertain FROM days").fetchone() == (10, 0)


@pytest.mark.parametrize("usage", [{}, {"promptTokenCount": True, "candidatesTokenCount": 2, "totalTokenCount": 3},
    {"promptTokenCount": 5, "candidatesTokenCount": 2, "thoughtsTokenCount": -1, "totalTokenCount": 6},
    {"promptTokenCount": 5, "candidatesTokenCount": 2, "totalTokenCount": 10}])
def test_unknown_usage_holds_full_reservation(app_factory, body, usage):
    app = app_factory(lambda _: httpx.Response(200, json=gemini_completion(usage=usage)), assistants=PROFILE)
    with TestClient(app) as client:
        assert client.post("/v1/chat", json=body).status_code == 200
        with sqlite3.connect(app.state.completion_service.ledger.path) as db:
            assert db.execute("SELECT reserved,confirmed,uncertain FROM days").fetchone() == (0, 0, RESERVATION)


@pytest.mark.parametrize("chunks,error,status", [
    ([b"{"], None, 502), ([b""], httpx.ReadTimeout("private"), 504),
    ([b"a" * (256 * 1024 + 1), b"not-read"], None, 502),
])
def test_stream_closed_and_bounded(app_factory, body, chunks, error, status):
    stream = TrackedStream(chunks, error)
    app = app_factory(lambda _: httpx.Response(200, stream=stream), assistants=PROFILE)
    with TestClient(app) as client:
        assert client.post("/v1/chat", json=body).status_code == status
        assert stream.closed and stream.read_count == 1


def test_deadline_cancels_gemini_stream(app_factory, body):
    class SlowStream(httpx.AsyncByteStream):
        closed = False
        async def __aiter__(self):
            await asyncio.sleep(10)
            yield b"{}"
        async def aclose(self):
            self.closed = True
    stream = SlowStream()
    app = app_factory(lambda _: httpx.Response(200, stream=stream), assistants=PROFILE, request_timeout=.05)
    with TestClient(app) as client:
        assert client.post("/v1/chat", json=body).status_code == 504
    assert stream.closed


def test_role_translation_and_thoughts_are_not_published(app_factory, body):
    body["messages"] = [{"role": "user", "content": "Hello"}, {"role": "assistant", "content": "Hi"},
                        {"role": "user", "content": "Again"}]
    def handler(request):
        assert [item["role"] for item in json.loads(request.content)["contents"]] == ["user", "model", "user"]
        data = gemini_completion()
        data["candidates"][0]["content"]["parts"].insert(0, {"thought": True, "text": "private thought"})
        return httpx.Response(200, json=data)
    with TestClient(app_factory(handler, assistants=PROFILE)) as client:
        response = client.post("/v1/chat", json=body)
        assert response.status_code == 200
        assert response.json()["text"] == "Hello"
