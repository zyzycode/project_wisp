"""Shared reflection wire matrix and atomic optional context, without provider calls."""

import json
from typing import Any

import pytest
from pydantic import ValidationError
from tests.helpers import CONTRACT_FIXTURES
from wisp_backend.api.dispatch import prepare_job
from wisp_backend.api.schemas.events import EventRequest
from wisp_backend.api.schemas.interaction import InteractionChatRequest, InteractionTouchRequest
from wisp_backend.api.schemas.life_history import LifeReflection
from wisp_backend.api.schemas.observation import ObservationRequest
from wisp_backend.api.schemas.summary import SummaryRequest
from wisp_backend.completion.context import ContextBlock, render_messages, select_context

FIXTURES = CONTRACT_FIXTURES / "desktop-backend-v1"
REFLECTION = FIXTURES / "life-history" / "reflection"


def read(name: str) -> dict[str, Any]:
    return json.loads((FIXTURES / name).read_bytes())


@pytest.mark.parametrize("case", json.loads((REFLECTION / "invalid.json").read_bytes()), ids=lambda c: c["name"])
def test_invalid_shared_matrix(case: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        LifeReflection.model_validate(case["value"])
    with pytest.raises(ValidationError):
        InteractionChatRequest.model_validate({**read("request.valid.json"), "lifeReflection": case["value"]})


def test_only_ordinary_chat_accepts_reflection() -> None:
    value = json.loads((REFLECTION / "full.json").read_bytes())
    assert LifeReflection.model_validate(value).model_dump() == value
    assert (
        InteractionChatRequest.model_validate({**read("request.valid.json"), "lifeReflection": value}).lifeReflection
        is not None
    )
    chat = read("request.valid.json")
    event = {key: chat[key] for key in ["requestId", "stream", "locale", "character", "memory"]}
    event["event"] = {"type": "social_bid_started", "occurredAt": "2026-11-05T10:00:00.000Z"}
    for schema, body in [
        (EventRequest, event),
        (InteractionTouchRequest, read("request.touch.json")),
        (ObservationRequest, read("observation/request.valid.json")),
        (SummaryRequest, {}),
    ]:
        with pytest.raises(ValidationError):
            schema.model_validate({**body, "lifeReflection": value})
    with pytest.raises(ValidationError):
        InteractionChatRequest.model_validate({**chat, "lifeReflection": None})


def test_atomic_optional_block_preserves_the_exact_baseline_and_has_separate_provenance() -> None:
    body = read("request.valid.json")
    baseline = prepare_job(InteractionChatRequest.model_validate(body)).inference.blocks
    body["lifeReflection"] = json.loads((REFLECTION / "full.json").read_bytes())
    enriched = prepare_job(InteractionChatRequest.model_validate(body)).inference.blocks
    block = next(block for block in enriched if block.key == "life_reflection")
    assert (block.priority, block.order, block.required, block.source) == (20, 46, False, "desktop_life_reflection")
    assert block.messages[0].role == "user" and block.server_instructions
    assert tuple(block for block in enriched if block.key != "life_reflection") == baseline

    def size(blocks: tuple[ContextBlock, ...]) -> int:
        return len(json.dumps(render_messages(blocks), ensure_ascii=False).encode("utf-8"))

    selected = select_context(enriched, size(baseline), size)
    assert selected == select_context(baseline, size(baseline), size)
    assert not any(block.key == "life_reflection" for block in selected)
    assert any(block.key == "life_reflection" for block in select_context(enriched, size(enriched), size))
