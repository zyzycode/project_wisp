"""Managed auth sits outside the existing request parser, logging and runtime."""

import asyncio
import io
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from starlette.types import Message, Scope
from tests.api.test_interaction_validation import fixture
from tests.test_managed_bootstrap import record
from wisp_backend.managed import create_managed_app
from wisp_backend.managed_bootstrap import read_bootstrap

AUTH = {"Authorization": "Bearer " + "a1" * 32}


@pytest.mark.parametrize(
    "route", ["/health", "/v1/chat", "/v1/touch", "/v1/events", "/v1/observation", "/v1/summary", "/docs", "/unknown"]
)
def test_every_route_requires_the_token_before_reading_body(tmp_path: Path, route: str) -> None:
    app = create_managed_app(read_bootstrap(io.BytesIO(record(tmp_path))))
    scope: Scope = {"type": "http", "method": "POST", "path": route, "headers": []}
    sent: list[Message] = []

    async def receive() -> Message:
        pytest.fail("unauthorized body must not be read")

    async def send(message: Message) -> None:
        sent.append(message)

    asyncio.run(app(scope, receive, send))
    assert sent[0]["status"] == 401
    assert sent[1]["body"] == b'{"error":"unauthorized"}'


@pytest.mark.parametrize(
    "headers",
    [
        {},
        {"Authorization": "Bearer wrong"},
        {"Authorization": "Bearer " + "A1" * 32},
        {"Cookie": "sessionToken=" + "a1" * 32},
        AUTH | {"Origin": "null"},
        AUTH | {"Origin": "http://localhost"},
        [("Authorization", AUTH["Authorization"]), ("Authorization", AUTH["Authorization"])],
    ],
)
def test_invalid_auth_and_origin_are_constant_refusals(tmp_path: Path, headers: object) -> None:
    def provider(_: httpx.Request) -> httpx.Response:
        pytest.fail("refused requests must never reach the provider")

    app = create_managed_app(read_bootstrap(io.BytesIO(record(tmp_path))), httpx.MockTransport(provider))
    with TestClient(app) as client:
        response = client.post("/v1/chat?sessionToken=" + "a1" * 32, content=b"not-json", headers=headers)
        assert response.status_code == 401
        assert response.json() == {"error": "unauthorized"}
        assert "access-control-allow-origin" not in response.headers


def test_startup_health_docs_and_shutdown_do_not_call_provider(tmp_path: Path) -> None:
    def provider(_: httpx.Request) -> httpx.Response:
        pytest.fail("readiness is not a provider probe")

    app = create_managed_app(read_bootstrap(io.BytesIO(record(tmp_path))), httpx.MockTransport(provider))
    with TestClient(app) as client:
        assert client.get("/health", headers=AUTH).json() == {"status": "ok"}
        for route in ("/docs", "/redoc", "/openapi.json"):
            assert client.get(route, headers=AUTH).status_code == 404


def test_authenticated_request_uses_existing_runtime(tmp_path: Path, chat_completion) -> None:
    calls = []

    def provider(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(200, json=chat_completion())

    app = create_managed_app(read_bootstrap(io.BytesIO(record(tmp_path))), httpx.MockTransport(provider))
    with TestClient(app) as client:
        response = client.post("/v1/chat", json=fixture("request.chat.json"), headers=AUTH)
        assert response.status_code == 200
        assert len(calls) == 1
        assert calls[0].headers["Authorization"] == "Bearer synthetic-openai-key"
        assert AUTH["Authorization"] not in str(calls[0].headers)
