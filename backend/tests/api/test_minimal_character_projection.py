"""The model receives raw facts and permission, without redundant state labels."""

import copy
import json

import pytest
from pydantic import ValidationError
from tests.helpers import CONTRACT_FIXTURES
from wisp_backend.api.dispatch import prepare_job
from wisp_backend.api.endpoints import ENDPOINTS
from wisp_backend.completion.context import render_messages
from wisp_backend.completion.prompts.narrative import reference_lines

CASES = [
    ("/v1/chat", "request.valid.json"),
    ("/v1/touch", "interaction/request.touch.json"),
    ("/v1/events", "events/request.game.json"),
    ("/v1/observation", "observation/request.valid.json"),
]


def minimal_body(fixture: str) -> dict:
    body = json.loads((CONTRACT_FIXTURES / "desktop-backend-v1" / fixture).read_text())
    character = body["character"]
    character.pop("synthesizedTone", None)
    character["expression"] = {"romanceAllowed": character["expression"]["romanceAllowed"]}
    return body


@pytest.mark.parametrize("route,fixture", CASES)
def test_minimal_character_keeps_all_raw_facts_and_permission(route: str, fixture: str) -> None:
    body = minimal_body(fixture)
    request = ENDPOINTS[route].request_type.model_validate(body)
    messages = render_messages(prepare_job(request).inference.blocks)
    block = next(m["content"] for m in messages if m["content"].startswith("[Character card"))
    assert block.splitlines()[1:] == reference_lines(body["character"])
    text = "\n".join(m["content"] for m in messages)
    assert "synthesizedTone" not in text
    for band in ("pace", "trust", "attention", "play"):
        assert f"expression.{band}" not in text
    assert "expression.romanceAllowed is false" in text
    assert "intimacy.userConsentEnabled is false" in text


@pytest.mark.parametrize(
    "field,value",
    [("synthesizedTone", "sleepy"), ("pace", "gentle"), ("trust", "close"), ("attention", "high"), ("play", "high")],
)
def test_removed_labels_are_unknown_wire_keys(field: str, value: str) -> None:
    body = minimal_body("request.valid.json")
    target = body["character"] if field == "synthesizedTone" else body["character"]["expression"]
    target[field] = value
    with pytest.raises(ValidationError):
        ENDPOINTS["/v1/chat"].request_type.model_validate(body)


@pytest.mark.parametrize("value", [None, 0, 1, "false"])
def test_permission_never_coerces_unknown_values(value: object) -> None:
    body = minimal_body("request.valid.json")
    body["character"]["expression"]["romanceAllowed"] = value
    with pytest.raises(ValidationError):
        ENDPOINTS["/v1/chat"].request_type.model_validate(body)


def test_optional_boredom_absence_and_independent_consent_remain_facts() -> None:
    body = minimal_body("request.valid.json")
    body["character"]["needs"].pop("boredom", None)
    body["character"]["intimacy"]["userConsentEnabled"] = True
    body["character"]["expression"]["romanceAllowed"] = False
    original = copy.deepcopy(body)
    validated = ENDPOINTS["/v1/chat"].request_type.model_validate(body)
    assert validated.character.model_dump(exclude_unset=True) == original["character"]
