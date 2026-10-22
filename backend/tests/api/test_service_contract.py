"""Provider-port results must be validated and accounted even without an HTTP adapter."""

import json
import sqlite3
from collections.abc import Callable

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from tests.helpers import CONTRACT_FIXTURES
from wisp_backend.accounting.contracts import Usage
from wisp_backend.completion.contracts import InferenceRequest, ProviderResult

FIXTURES = CONTRACT_FIXTURES
ROUTES = [
    ("/v1/chat", "desktop-backend-v1/request.valid.json"),
    ("/v1/touch", "desktop-backend-v1/request.touch.json"),
    ("/v1/chat", "desktop-backend-v1/memory/request.valid.json"),
    ("/v1/chat", "desktop-backend-v1/events/request.chat.json"),
    ("/v1/events", "desktop-backend-v1/events/request.game.json"),
]


@pytest.mark.parametrize("route,fixture", ROUTES)
@pytest.mark.parametrize("result_kind", ["success", "invalid_reply", "invalid_json", "provider_error", "missing_reply"])
def test_service_validates_accounts_and_replays(
    app_factory: Callable[..., FastAPI],
    route: str,
    fixture: str,
    result_kind: str,
) -> None:
    body = json.loads((FIXTURES / fixture).read_text(encoding="utf-8"))
    reply = {"text": "Hello"}
    if route != "/v1/events":
        reply["appraisal"] = {"category": "neutral", "intensity": "low", "confidence": "clear"}
    result = ProviderResult(json.dumps(reply), Usage(5, 2, 7))
    expected_status, expected_error = 200, None
    if result_kind in {"invalid_reply", "invalid_json"}:
        result = ProviderResult('{"text":""}' if result_kind == "invalid_reply" else "{", result.usage)
        expected_status, expected_error = 502, "invalid_model_response"
    elif result_kind == "provider_error":
        result = ProviderResult(usage=result.usage, error="upstream_unavailable")
        expected_status, expected_error = 503, "upstream_unavailable"
    elif result_kind == "missing_reply":
        result = ProviderResult(usage=result.usage)
        expected_status, expected_error = 502, "invalid_model_response"

    class StubProvider:
        calls = 0

        async def complete(self, request: InferenceRequest, timeout: float) -> ProviderResult:
            self.calls += 1
            return result

    provider = StubProvider()
    app = app_factory(lambda _: pytest.fail("Unexpected provider HTTP call"))
    with TestClient(app) as client:
        service = app.state.completion_service
        service.provider = provider
        response = client.post(route, json=body)
        expected: dict[str, object] = {"requestId": body["requestId"]}
        expected.update(reply if expected_error is None else {"error": {"code": expected_error}})
        assert response.status_code == expected_status
        assert response.json() == expected
        replay = client.post(route, json=body)
        assert (replay.status_code, replay.content) == (response.status_code, response.content)
        assert provider.calls == 1
        with sqlite3.connect(service.ledger.path) as db:
            assert db.execute("SELECT requests,reserved,confirmed,uncertain FROM days").fetchone() == (1, 0, 7, 0)


@pytest.mark.parametrize("route,fixture", [ROUTES[1], ROUTES[4]])
def test_text_only_routes_reject_chat_fields_before_sanitization(
    app_factory: Callable[..., FastAPI],
    route: str,
    fixture: str,
) -> None:
    body = json.loads((FIXTURES / fixture).read_text(encoding="utf-8"))

    class WrongReplyProvider:
        async def complete(self, request: InferenceRequest, timeout: float) -> ProviderResult:
            return ProviderResult('{"text":"Hello","decision":{"unknown":"value"}}', Usage(5, 2, 7))

    app = app_factory(lambda _: pytest.fail("Unexpected provider HTTP call"))
    with TestClient(app) as client:
        app.state.completion_service.provider = WrongReplyProvider()
        response = client.post(route, json=body)
        assert response.status_code == 502
        assert response.json()["error"]["code"] == "invalid_model_response"
