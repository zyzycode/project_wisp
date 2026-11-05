import copy
import json

import pytest
from pydantic import ValidationError
from tests.helpers import CONTRACT_FIXTURES
from wisp_backend.api.dispatch import prepare_job
from wisp_backend.api.schemas.causal_expression import CausalExpression
from wisp_backend.api.schemas.common import Expression
from wisp_backend.api.schemas.events import EventRequest
from wisp_backend.api.schemas.interaction import InteractionChatRequest, InteractionTouchRequest
from wisp_backend.api.schemas.observation import ObservationRequest
from wisp_backend.completion.context import ContextOverflow, render_messages, select_context

FIXTURES = CONTRACT_FIXTURES / "desktop-backend-v1"
CAUSAL = FIXTURES / "causal-expression"


def read(name: str) -> dict[str, object]:
    return json.loads((FIXTURES / name).read_bytes())


def test_exact_causal_projection_and_allowed_consumers() -> None:
    value = json.loads((CAUSAL / "full.json").read_bytes())
    assert CausalExpression.model_validate(value).model_dump() == value
    assert Expression.model_validate(json.loads((CAUSAL / "absent.json").read_bytes())).causal is None
    chat = read("request.valid.json")
    chat["character"]["expression"]["causal"] = value
    assert InteractionChatRequest.model_validate(chat).character.expression.causal.model_dump() == value
    touch = read("request.touch.json")
    touch["character"]["expression"]["causal"] = value
    touch["effectPolicy"] = "suppressed"
    InteractionTouchRequest.model_validate(touch)
    touch["effectPolicy"] = "eligible"
    with pytest.raises(ValidationError):
        InteractionTouchRequest.model_validate(touch)
    event = {key: chat[key] for key in ["requestId", "stream", "locale", "character", "memory"]}
    event["event"] = {"type": "social_bid_started", "occurredAt": "2026-11-05T10:00:00.000Z"}
    EventRequest.model_validate(event)
    observation = read("observation/request.valid.json")
    observation["character"]["expression"]["causal"] = value
    with pytest.raises(ValidationError):
        ObservationRequest.model_validate(observation)


@pytest.mark.parametrize("case", json.loads((CAUSAL / "invalid.json").read_bytes()), ids=lambda case: case["name"])
def test_shared_invalid_causal_matrix(case: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        CausalExpression.model_validate(case["value"])
    chat = copy.deepcopy(read("request.valid.json"))
    chat["character"]["expression"]["causal"] = case["value"]
    with pytest.raises(ValidationError):
        InteractionChatRequest.model_validate(chat)


@pytest.mark.parametrize("mode", ["chat", "touch", "events"])
def test_causal_decision_is_one_mandatory_block_and_never_budget_dropped(mode: str) -> None:
    causal = json.loads((CAUSAL / "full.json").read_bytes())
    body = read("request.touch.json" if mode == "touch" else "request.valid.json")
    body["character"]["expression"]["causal"] = causal
    if mode == "touch":
        body["effectPolicy"] = "suppressed"
        request = InteractionTouchRequest.model_validate(body)
    elif mode == "events":
        body = {key: body[key] for key in ["requestId", "stream", "locale", "character", "memory"]}
        body["event"] = {"type": "social_bid_started", "occurredAt": "2026-11-05T10:00:00.000Z"}
        request = EventRequest.model_validate(body)
    else:
        request = InteractionChatRequest.model_validate(body)
    blocks = prepare_job(request).inference.blocks
    selected = next(block for block in blocks if block.key == "causal_expression")
    assert (selected.required, selected.priority, selected.order) == (True, 1000, 12)
    assert "already chose" in selected.server_instructions
    profile = next(block for block in blocks if block.key == "character_profile_state")
    assert "causal" not in profile.messages[0].content
    text = "\n".join(message["content"] for message in render_messages(blocks))
    assert text.count("Current desktop causal decision:") == 1
    assert "user_interrupted" in text and "localSequence" not in text
    with pytest.raises(ContextOverflow):
        select_context(
            blocks, 1, lambda values: sum(len(message.content) for block in values for message in block.messages)
        )
    body["character"]["expression"].pop("causal")
    ordinary = type(request).model_validate(body)
    assert all(block.key != "causal_expression" for block in prepare_job(ordinary).inference.blocks)
