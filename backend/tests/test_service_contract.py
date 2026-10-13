"""Service guarantees also hold for provider implementations bypassing HTTP parsing."""
import json
import sqlite3
from collections.abc import Callable
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from wisp_backend.completion_policy import CompletionReply
from wisp_backend.config import AssistantSettings
from wisp_backend.contracts import ProviderResult, ReplyContext, Usage
from wisp_backend.events_schemas import EventModelReply
from wisp_backend.memory_schemas import MemoryModelReply
from wisp_backend.schemas import ModelReply
from wisp_backend.touch_schemas import TouchModelReply

FIXTURES = Path(__file__).resolve().parents[2] / "docs/contracts/fixtures"
ROUTES = [
    ("/v1/chat", "desktop-backend-v1/request.valid.json", ModelReply),
    ("/v1/touch", "desktop-backend-v1/request.touch.json", TouchModelReply),
    ("/v2/chat", "desktop-backend-v2/request.valid.json", MemoryModelReply),
    ("/v3/chat", "desktop-backend-v3/request.chat.json", MemoryModelReply),
    ("/v3/events", "desktop-backend-v3/request.game.json", EventModelReply),
]


@pytest.mark.parametrize("route,fixture,reply_type", ROUTES)
@pytest.mark.parametrize("result_kind", ["success", "invalid_reply", "provider_error", "missing_reply"])
def test_service_revalidates_accounts_and_replays(
    app_factory: Callable[..., FastAPI], route: str, fixture: str,
    reply_type: type[CompletionReply], result_kind: str,
) -> None:
    body = json.loads((FIXTURES / fixture).read_text(encoding="utf-8"))
    result = ProviderResult(reply_type(text="Hello"), Usage(5, 2, 7))
    expected_status, expected_error = 200, None
    if result_kind == "invalid_reply":
        result = ProviderResult(reply_type.model_construct(text=""), result.usage)
        expected_status, expected_error = 502, "invalid_model_response"
    elif result_kind == "provider_error":
        result = ProviderResult(usage=result.usage, error="upstream_unavailable")
        expected_status, expected_error = 503, "upstream_unavailable"
    elif result_kind == "missing_reply":
        result = ProviderResult(usage=result.usage)
        expected_status, expected_error = 502, "invalid_model_response"

    class StubProvider:
        calls = 0

        async def complete(self, messages: list[dict[str, str]], settings: AssistantSettings,
                           timeout: float, reply_context: ReplyContext = ReplyContext()) -> ProviderResult:
            self.calls += 1
            return result

    provider = StubProvider()
    app = app_factory(lambda _: pytest.fail("Unexpected provider HTTP call"))
    with TestClient(app) as client:
        service = app.state.chat_service
        service.providers["groq"] = provider
        response = client.post(route, json=body)
        expected: dict[str, object] = {"version": body["version"], "requestId": body["requestId"]}
        expected.update({"text": "Hello"} if expected_error is None else {"error": {"code": expected_error}})
        assert response.status_code == expected_status
        assert response.json() == expected
        replay = client.post(route, json=body)
        assert (replay.status_code, replay.content) == (response.status_code, response.content)
        assert provider.calls == 1
        with sqlite3.connect(service.ledger.path) as db:
            assert db.execute("SELECT requests,reserved,confirmed,uncertain FROM days").fetchone() == (1, 0, 7, 0)


@pytest.mark.parametrize("route,fixture", [ROUTES[1][:2], ROUTES[4][:2]])
def test_text_only_routes_reject_chat_reply_even_with_matching_fields(
    app_factory: Callable[..., FastAPI], route: str, fixture: str,
) -> None:
    body = json.loads((FIXTURES / fixture).read_text(encoding="utf-8"))

    class WrongReplyProvider:
        async def complete(self, messages: list[dict[str, str]], settings: AssistantSettings,
                           timeout: float, reply_context: ReplyContext = ReplyContext()) -> ProviderResult:
            return ProviderResult(ModelReply(text="Hello"), Usage(5, 2, 7))

    app = app_factory(lambda _: pytest.fail("Unexpected provider HTTP call"))
    with TestClient(app) as client:
        client.app.state.chat_service.providers["groq"] = WrongReplyProvider()
        response = client.post(route, json=body)
        assert response.status_code == 502
        assert response.json()["error"]["code"] == "invalid_model_response"
