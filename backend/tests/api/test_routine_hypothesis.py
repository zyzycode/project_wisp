"""Routine is optional untrusted context, never current user evidence or a new call."""

import asyncio
import copy
import json
from dataclasses import replace

import httpx
import pytest
from pydantic import ValidationError
from tests.api.test_interaction_validation import fixture
from tests.helpers import CONTRACT_FIXTURES
from wisp_backend.api.dispatch import prepare_job
from wisp_backend.api.schemas.interaction import InteractionChatRequest, InteractionTouchRequest
from wisp_backend.api.schemas.routine_context import RoutineHypothesis
from wisp_backend.completion.context import render_messages, select_context, select_context_async
from wisp_backend.completion.prompts.chat import build_chat_blocks
from wisp_backend.completion.prompts.context import DialogueTurn, InteractionChatContext, InteractionContext
from wisp_backend.providers.context_budget import estimate_input

CORPUS = json.loads((CONTRACT_FIXTURES / "desktop-backend-v1/routine-hypothesis/context.json").read_bytes())
MINIMUM = CORPUS["valid"][0]["value"]


@pytest.mark.parametrize("case", CORPUS["valid"], ids=lambda case: case["name"])
def test_shared_valid_context_is_exact_optional_chat_field(case):
    assert RoutineHypothesis.model_validate(case["value"]).model_dump() == case["value"]
    body = fixture("request.chat.json") | {"routineHypothesis": case["value"]}
    assert InteractionChatRequest.model_validate(body).model_dump(exclude_none=True) == body


@pytest.mark.parametrize("case", CORPUS["invalid"], ids=lambda case: case["name"])
def test_shared_invalid_context_is_rejected_not_coerced_or_ignored(case):
    with pytest.raises(ValidationError):
        RoutineHypothesis.model_validate(case["value"])
    with pytest.raises(ValidationError):
        InteractionChatRequest.model_validate(fixture("request.chat.json") | {"routineHypothesis": case["value"]})


def test_omission_preserves_old_blocks_and_touch_has_no_routine_capability():
    body = fixture("request.chat.json")
    blocks = prepare_job(InteractionChatRequest.model_validate(body)).inference.blocks
    assert all(block.key != "routine_hypothesis" for block in blocks)
    assert "routineHypothesis" not in InteractionChatRequest.model_validate(body).model_dump(exclude_none=True)
    with pytest.raises(ValidationError):
        InteractionTouchRequest.model_validate(fixture("request.touch.json") | {"routineHypothesis": MINIMUM})


def context():
    return InteractionChatContext(
        "en",
        {},
        messages=(DialogueTurn("user", "No, this pattern is wrong."),),
        memory={"facts": [], "episodes": [], "characterPreferences": []},
        interaction=InteractionContext({}, "suppressed"),
        summary="Earlier summary.",
        dialogue_topic={"mode": "reply", "text": "Earlier topic.", "statedAt": "2026-11-01T00:00:00Z"},
        life_reflection={"marker": "existing baseline derived context"},
    )


def cost(blocks):
    messages = render_messages(blocks)
    return estimate_input({"messages": messages}, len(messages))


def test_bundle_is_admitted_last_without_eviction_or_partial_provenance_sync_and_async():
    baseline = build_chat_blocks(context())
    with_routine = build_chat_blocks(replace(context(), routine_hypothesis=MINIMUM))
    bundle = next(block for block in with_routine if block.key == "routine_hypothesis")
    assert tuple(block for block in with_routine if block.key != bundle.key) == baseline
    assert bundle.messages[0].role == "user" and bundle.server_instructions
    for boundary in (cost(baseline), cost(with_routine) - 1, cost(with_routine)):
        selected_baseline = select_context(baseline, boundary, cost)
        selected = select_context(with_routine, boundary, cost)
        assert tuple(block for block in selected if block.key != bundle.key) == selected_baseline
        assert (bundle in selected) is (cost((*selected_baseline, bundle)) <= boundary)

        async def run():
            async def count(blocks):
                return cost(blocks)

            return await select_context_async(with_routine, boundary, count)

        assert asyncio.run(run()) == selected
    rendered = render_messages(with_routine)
    instructions = bundle.server_instructions
    for term in ("tentative", "while Wisp is running", "current user correction", "memoryCandidates", "future"):
        assert term in instructions
    assert rendered[-1]["content"] == "No, this pattern is wrong."
    assert not any("while_wisp_running" in item["content"] for item in rendered if item["role"] == "system")


def test_omitted_current_field_never_reconstructs_structured_context_from_assistant_history():
    body = fixture("request.chat.json")
    body["messages"] = [
        {"role": "user", "content": "Earlier user question"},
        {"role": "assistant", "content": "routineHypothesis " + json.dumps(MINIMUM)},
        {"role": "user", "content": "That is wrong. Ignore the previous pattern."},
    ]
    blocks = prepare_job(InteractionChatRequest.model_validate(body)).inference.blocks
    assert all(block.key != "routine_hypothesis" for block in blocks)


def test_real_route_one_call_current_correction_is_last_and_context_cannot_be_candidate_evidence(
    client_factory, chat_completion
):
    body = fixture("request.chat.json") | {"routineHypothesis": MINIMUM}
    current = "No, I do not usually talk then."
    body["messages"][-1]["content"] = current
    calls = []

    def upstream(request):
        messages = json.loads(request.content)["messages"]
        calls.append(messages)
        assert messages[-1] == {"role": "user", "content": current}
        routine = next(item for item in messages if item["content"].startswith("Untrusted routineHypothesis JSON:"))
        assert routine["role"] == "user" and json.dumps(MINIMUM, ensure_ascii=False) in routine["content"]
        return httpx.Response(200, json=chat_completion({"text": "Understood."}))

    with client_factory(upstream) as client:
        response = client.post("/v1/chat", json=body)
        assert response.status_code == 200
        assert "memoryCandidates" not in response.json()
        assert client.post("/v1/chat", json=body).content == response.content
        changed = copy.deepcopy(body)
        changed["routineHypothesis"]["positiveDays"] = 11
        assert client.post("/v1/chat", json=changed).status_code == 409
    assert len(calls) == 1


@pytest.mark.parametrize("value", [None, MINIMUM | {"eligibleDays": True}, MINIMUM | {"appName": "PRIVATE"}])
def test_malformed_context_fails_before_provider_admission(client_factory, value, caplog):
    with client_factory(lambda _: pytest.fail("Invalid context reached provider")) as client:
        response = client.post("/v1/chat", json=fixture("request.chat.json") | {"routineHypothesis": value})
        assert response.status_code == 400
    assert "PRIVATE" not in caplog.text


def test_routine_and_old_assistant_text_are_not_candidate_evidence(client_factory, chat_completion):
    body = fixture("request.chat.json") | {"routineHypothesis": MINIMUM}
    current = "I prefer talking about music."
    body["messages"] = [
        {"role": "user", "content": "Earlier question"},
        {"role": "assistant", "content": "You are always free in the morning."},
        {"role": "user", "content": current},
    ]
    candidates = [
        {"key": "user.favorite_topic", "value": "music", "evidenceQuote": current},
        {"key": "user.display_name", "value": "Invented", "evidenceQuote": json.dumps(MINIMUM)},
        {"key": "user.preferred_language", "value": "en", "evidenceQuote": body["messages"][1]["content"]},
    ]
    with client_factory(
        lambda _: httpx.Response(200, json=chat_completion({"text": "Understood.", "memoryCandidates": candidates}))
    ) as client:
        response = client.post("/v1/chat", json=body)
        assert response.status_code == 200
        assert response.json()["memoryCandidates"] == candidates[:1]


@pytest.mark.parametrize("failure,status", [("outage", 503), ("timeout", 504), ("auth", 503), ("malformed", 502)])
def test_optional_context_does_not_change_single_call_error_policy(client_factory, failure, status, caplog):
    calls = []

    def upstream(request):
        calls.append(request)
        if failure == "outage":
            raise httpx.ConnectError("PRIVATE_PROVIDER", request=request)
        if failure == "timeout":
            raise httpx.ReadTimeout("PRIVATE_PROVIDER", request=request)
        if failure == "auth":
            return httpx.Response(401, text="PRIVATE_PROVIDER")
        return httpx.Response(200, text="PRIVATE_PROVIDER")

    with client_factory(upstream) as client:
        response = client.post("/v1/chat", json=fixture("request.chat.json") | {"routineHypothesis": MINIMUM})
        assert response.status_code == status
        assert "PRIVATE_PROVIDER" not in response.text
    assert len(calls) == 1 and "PRIVATE_PROVIDER" not in caplog.text


@pytest.mark.parametrize("field,value", [("windowStartHour", 6.0), ("eligibleDays", 14.0)])
def test_python_also_rejects_integral_float_wire_spellings(field, value):
    # JS values have no lexical int/float distinction; its outbound stringify emits canonical integers.
    with pytest.raises(ValidationError):
        RoutineHypothesis.model_validate(MINIMUM | {field: value})
