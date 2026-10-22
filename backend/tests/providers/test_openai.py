"""Mocked OpenAI transport, public routes, accounting and cancellation."""

import asyncio
import json
import sqlite3

import httpx
import pytest

from tests.helpers import CONTRACT_FIXTURES, TrackedStream
from wisp_backend.accounting.contracts import Usage
from wisp_backend.completion.context import ContextBlock, ContextMessage
from wisp_backend.completion.contracts import InferenceRequest
from wisp_backend.config.profiles import PROFILES
from wisp_backend.config.settings import AssistantSettings
from wisp_backend.providers.openai import OpenAIProvider


PROFILE = {"default": {"provider": "openai", "temperature": 0.4}}


@pytest.mark.parametrize("route,folder,request_name,response_name,cap", [
    ("/v1/chat", "v1", "request.valid", "response.success", 4096),
    ("/v1/touch", "v1", "request.touch", "response.success", 4096),
    ("/v2/chat", "v2", "request.valid", "response.success", 4096),
    ("/v3/chat", "v3", "request.chat", "response.chat.success", 4096),
    ("/v3/events", "v3", "request.game", "response.event.success", 1024),
    ("/v3/events", "v3", "request.social", "response.event.success", 1024),
    ("/v5/chat", "v5", "request.chat", "response.chat.success", 4096),
    ("/v5/summary", "v5", "request.summary", "response.summary.success", 512),
    ("/v6/observation", "v6", "request.valid", "response.success", 1024),
    ("/v7/chat", "v7", "request.chat", "response.chat", 4096),
    ("/v7/touch", "v7", "request.touch", "response.touch", 1024),
])
def test_routes_translate_and_account(app_factory, completion, route, folder, request_name, response_name, cap):
    fixtures = CONTRACT_FIXTURES / f"desktop-backend-{folder}"
    body = json.loads((fixtures / f"{request_name}.json").read_text())
    expected = json.loads((fixtures / f"{response_name}.json").read_text())
    reply = {key: value for key, value in expected.items() if key not in {"version", "requestId"}}
    if route == "/v1/touch":
        reply = {"text": reply["text"]}
    calls = []

    def handler(request):
        calls.append(request)
        assert str(request.url) == "https://api.openai.com/v1/chat/completions"
        assert request.headers["authorization"] == "Bearer test-key"
        assert "x-goog-api-key" not in request.headers
        payload = json.loads(request.content)
        assert payload["model"] == "gpt-4.1-mini"
        assert payload["store"] is False and payload["stream"] is False
        assert payload["response_format"] == {"type": "json_object"}
        assert payload["max_completion_tokens"] == cap
        assert payload["temperature"] == 0.4
        assert payload["messages"][0]["role"] == "system"
        assert "json" in json.dumps(payload["messages"]).lower()
        assert "tools" not in payload and "thinking_level" not in payload
        return httpx.Response(200, json=completion(reply))

    async def run():
        app = app_factory(handler, assistants=PROFILE)
        async with app.router.lifespan_context(app):
            upstream = app.state.completion_service.provider.client
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://test") as client:
                response = await client.post(route, json=body)
                assert response.status_code == 200, response.text
                assert response.json()["text"] == reply["text"]
                assert response.json()["requestId"] == body["requestId"]
                assert (await client.post(route, json=body)).json() == response.json()
                assert len(calls) == 1
            with sqlite3.connect(app.state.completion_service.ledger.path) as db:
                assert db.execute("SELECT reserved,confirmed,prompt,completion FROM days").fetchone() == (0, 7, 5, 2)
        assert upstream.is_closed
    asyncio.run(run())


@pytest.mark.parametrize("failure,status,code", [
    (401, 503, "upstream_unavailable"), (403, 503, "upstream_unavailable"),
    (429, 503, "upstream_unavailable"), (500, 503, "upstream_unavailable"),
    (302, 503, "upstream_unavailable"), ("connect", 503, "upstream_unavailable"),
    ("timeout", 504, "upstream_timeout"), ("json", 502, "invalid_model_response"),
])
def test_failures_are_safe_and_not_retried(app_factory, body, failure, status, code):
    calls = []

    def handler(request):
        calls.append(request)
        if failure == "connect":
            raise httpx.ConnectError("private provider detail", request=request)
        if failure == "timeout":
            raise httpx.ReadTimeout("private provider detail", request=request)
        if failure == "json":
            return httpx.Response(200, content=b"not-json")
        return httpx.Response(failure, text="private provider detail", headers={"location": "https://other.test"})

    async def run():
        app = app_factory(handler, assistants=PROFILE)
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://test") as client:
                response = await client.post("/v1/chat", json=body)
                assert response.status_code == status
                assert response.json()["error"]["code"] == code
                assert "private" not in response.text
                assert len(calls) == 1
    asyncio.run(run())


@pytest.mark.parametrize("kind", ["refusal", "length", "content_filter", "tools", "bad-text", "bad-envelope"])
def test_invalid_output_retains_known_usage(completion, kind):
    data = completion()
    choice = data["choices"][0]
    if kind == "refusal":
        choice["message"]["refusal"] = "private refusal"
    elif kind in {"length", "content_filter"}:
        choice["finish_reason"] = kind
    elif kind == "tools":
        choice["message"]["tool_calls"] = [{"id": "private"}]
    elif kind == "bad-text":
        choice["message"]["content"] = None
    else:
        data["choices"] = None

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(200, json=data)),
                                     base_url="https://api.openai.com/v1/") as client:
            result = await OpenAIProvider(client, AssistantSettings(provider="openai")).complete(InferenceRequest(()), 1)
            assert result.error == "invalid_model_response"
            assert result.usage == Usage(5, 2, 7)
    asyncio.run(run())


@pytest.mark.parametrize("usage", [None, {}, {"prompt_tokens": True, "completion_tokens": 2, "total_tokens": 3},
                                   {"prompt_tokens": 5, "completion_tokens": 2, "total_tokens": 6}])
def test_unknown_usage_remains_uncertain(app_factory, body, completion, usage):
    async def run():
        app = app_factory(lambda _: httpx.Response(200, json=completion(usage=usage)), assistants=PROFILE)
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://test") as client:
                assert (await client.post("/v1/chat", json=body)).status_code == 200
            with sqlite3.connect(app.state.completion_service.ledger.path) as db:
                assert db.execute("SELECT confirmed,uncertain FROM days").fetchone() == (0, PROFILES["openai"].reservation)
    asyncio.run(run())


def test_context_overflow_never_dispatches():
    def handler(_):
        pytest.fail("overflow reached provider")

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url="https://api.openai.com/v1/") as client:
            provider = OpenAIProvider(client, AssistantSettings(provider="openai"))
            block = ContextBlock("required", "server_instructions", True, 100, 0,
                                 (ContextMessage("system", "x" * 20_000),))
            result = await provider.complete(InferenceRequest((block,)), 1)
            assert result.error == "upstream_unavailable"
            assert result.usage == Usage(0, 0, 0)
    asyncio.run(run())


def test_oversized_response_closes_stream():
    stream = TrackedStream([b"x" * (256 * 1024 + 1), b"not-read"])

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(200, stream=stream)),
                                     base_url="https://api.openai.com/v1/") as client:
            result = await OpenAIProvider(client, AssistantSettings(provider="openai")).complete(InferenceRequest(()), 1)
            assert result.error == "invalid_model_response"
        assert stream.closed and stream.read_count == 1
    asyncio.run(run())
