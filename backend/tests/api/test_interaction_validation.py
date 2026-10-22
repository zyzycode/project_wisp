"""One executable v7 corpus consumed independently by Python and desktop."""

import json
from typing import Any

import pytest
from pydantic import ValidationError
from tests.helpers import CONTRACT_FIXTURES
from wisp_backend.api.schemas.interaction import (
    InteractionChatRequest,
    InteractionChatResponse,
    InteractionErrorResponse,
    InteractionTouchRequest,
    InteractionTouchResponse,
)
from wisp_backend.api.schemas.summary import SummaryChatRequest
from wisp_backend.api.schemas.touch import TouchRequest

FIXTURES = CONTRACT_FIXTURES / "desktop-backend-v7"
REQUESTS = {"/v7/touch": InteractionTouchRequest, "/v7/chat": InteractionChatRequest}
RESPONSES = {"/v7/touch": InteractionTouchResponse, "/v7/chat": InteractionChatResponse}


def fixture(name: str) -> Any:
    return json.loads((FIXTURES / name).read_bytes())


@pytest.mark.parametrize(
    "name,model",
    [
        ("request.touch.json", InteractionTouchRequest),
        ("request.chat.json", InteractionChatRequest),
        ("response.touch.json", InteractionTouchResponse),
        ("response.chat.json", InteractionChatResponse),
        ("response.error.json", InteractionErrorResponse),
    ],
)
def test_shared_success(name: str, model: type) -> None:
    value = fixture(name)
    assert model.model_validate(value).model_dump(exclude_none=True) == value


@pytest.mark.parametrize("case", fixture("invalid.json")["requests"], ids=lambda case: case["name"])
def test_shared_invalid_request(case: dict) -> None:
    with pytest.raises(ValidationError):
        REQUESTS[case["endpoint"]].model_validate(case["value"])


@pytest.mark.parametrize("case", fixture("invalid.json")["responses"], ids=lambda case: case["name"])
def test_shared_invalid_response(case: dict) -> None:
    with pytest.raises(ValidationError):
        RESPONSES[case["endpoint"]].model_validate(case["value"], context={"effect_policy": case["effectPolicy"]})


@pytest.mark.parametrize(
    "effect,reason",
    [
        ("accepted", "applied"),
        ("neutral", "neutral"),
        ("neutral", "uncertain"),
        ("suppressed", "cooldown"),
        ("rejected", "state_changed"),
        ("rejected", "unavailable"),
    ],
)
def test_previous_touch_effect_pairs(effect: str, reason: str) -> None:
    value = fixture("request.chat.json")
    value["previousTouch"].update(effect=effect, reason=reason)
    InteractionChatRequest.model_validate(value)


@pytest.mark.parametrize(
    "name,model,version", [("request.touch.json", TouchRequest, 1), ("request.chat.json", SummaryChatRequest, 5)]
)
def test_old_modes_reject_new_fields(name: str, model: type, version: int) -> None:
    body = fixture(name)
    body["version"] = version
    with pytest.raises(ValidationError):
        model.model_validate(body)


@pytest.mark.parametrize(
    "name,model,limit",
    [("response.touch.json", InteractionTouchResponse, 240), ("response.chat.json", InteractionChatResponse, 2000)],
)
def test_utf16_exact_response_boundary(name: str, model: type, limit: int) -> None:
    value = fixture(name)
    value["text"] = "😀" * (limit // 2)
    model.model_validate(value)
    value["text"] += "a"
    with pytest.raises(ValidationError):
        model.model_validate(value)
