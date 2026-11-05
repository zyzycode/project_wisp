import json

import pytest
from pydantic import ValidationError
from tests.helpers import CONTRACT_FIXTURES
from wisp_backend.api.schemas.events import EventRequest, EventResponse
from wisp_backend.api.schemas.memory import MemoryContext
from wisp_backend.completion.prompts.narrative import recalled_memory

FIXTURES = CONTRACT_FIXTURES / "desktop-backend-v1/causal-memory"


@pytest.mark.parametrize(
    "name", ["contact", "game.completed", "game.interrupted", "game.timeout", "game.environment-lost"]
)
def test_shared_causal_memory_facts(name):
    value = json.loads((FIXTURES / f"{name}.json").read_bytes())
    parsed = MemoryContext.model_validate(value)
    assert parsed.model_dump() == value
    prompt = recalled_memory(parsed.model_dump())
    assert "Actor is provenance, not motive" in prompt
    assert "cause" in prompt
    assert "localId" not in prompt


@pytest.mark.parametrize("case", json.loads((FIXTURES / "invalid.json").read_bytes()), ids=lambda case: case["name"])
def test_shared_invalid_matrix(case):
    with pytest.raises(ValidationError):
        MemoryContext.model_validate(case["memory"])


@pytest.mark.parametrize("number", [float("inf"), float("nan"), float("-inf")])
def test_nonfinite_causal_values(number):
    value = json.loads((FIXTURES / "game.completed.json").read_bytes())
    value["episodes"][0]["executedMs"] = number
    with pytest.raises(ValidationError):
        MemoryContext.model_validate(value)


def test_shared_event_memory_keeps_text_only_response():
    fixture = json.loads((CONTRACT_FIXTURES / "desktop-backend-v1/memory/request.valid.json").read_bytes())
    body = {key: fixture[key] for key in ["requestId", "stream", "locale", "character"]}
    body["event"] = {"type": "social_bid_started", "occurredAt": "2026-11-05T10:00:00.000Z"}
    body["memory"] = json.loads((FIXTURES / "game.completed.json").read_bytes())
    assert EventRequest.model_validate(body).memory.episodes[0].kind == "causal_event"
    EventResponse.model_validate({"requestId": body["requestId"], "text": "A response"})
    with pytest.raises(ValidationError):
        EventResponse.model_validate({"requestId": body["requestId"], "text": "A response", "memory": body["memory"]})
