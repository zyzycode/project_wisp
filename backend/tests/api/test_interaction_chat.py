"""Eligible chat stays one bounded inference; synthetic cases are not a live quality claim."""

import copy
import json
from collections.abc import Callable
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from tests.api.test_interaction_validation import fixture
from tests.helpers import gemini_completion
from wisp_backend.api.dispatch import prepare_job
from wisp_backend.api.schemas.interaction import InteractionChatRequest, InteractionChatResponse

CASES = fixture("chat.eligible.json")


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["name"])
def test_shared_eligible_chat_schema(case: dict[str, Any]) -> None:
    assert InteractionChatRequest.model_validate(case["request"]).model_dump(exclude_none=True) == case["request"]
    assert (
        InteractionChatResponse.model_validate(case["response"], context={"effect_policy": "eligible"}).model_dump(
            exclude_none=True
        )
        == case["response"]
    )


def test_eligible_prompt_has_current_message_semantics_without_rollout_override() -> None:
    context = prepare_job(InteractionChatRequest.model_validate(CASES[0]["request"])).inference.blocks
    system = next(block for block in context if block.key == "instructions").messages[0].content
    assert "In this rollout chat appraisal is neutral/low/clear" not in system
    assert "When effectPolicy is eligible" in system
    assert "explicit hostility directed at Wisp in the current user message" in system
    for distinction in ("role-play", "jokes", "sarcasm", "uncertain", "consent", "absence", "guilt"):
        assert distinction in system


def test_v7_output_contract_does_not_depend_on_legacy_prompt_wording(monkeypatch: pytest.MonkeyPatch) -> None:
    from wisp_backend.completion.prompts import chat

    monkeypatch.setattr(
        chat,
        "MEMORY_SYSTEM_PROMPT",
        chat.MEMORY_SYSTEM_PROMPT.replace(
            "optional decision, and optional memoryCandidates.", "You may also propose decision and memoryCandidates."
        ),
    )
    blocks = prepare_job(InteractionChatRequest.model_validate(CASES[0]["request"])).inference.blocks
    instructions = next(block for block in blocks if block.key == "instructions").messages[0].content
    assert "required appraisal, optional decision, and optional memoryCandidates." in instructions


@pytest.mark.parametrize("provider", ["groq", "gemini"])
@pytest.mark.parametrize("case", CASES, ids=lambda case: case["name"])
def test_eligible_cases_through_real_route_and_provider(
    app_factory: Callable[..., FastAPI], completion: Callable[..., dict], provider: str, case: dict[str, Any]
) -> None:
    calls = []
    body = case["request"]
    reply = {key: value for key, value in case["response"].items() if key not in ("version", "requestId")}

    def upstream(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        calls.append(payload)
        if provider == "groq":
            system = payload["messages"][0]["content"]
            messages = payload["messages"][1:]
            assert payload["max_completion_tokens"] == 4096
        else:
            system = payload["systemInstruction"]["parts"][0]["text"]
            messages = [
                {"role": m["role"], "content": part["text"]} for m in payload["contents"] for part in m["parts"]
            ]
            assert payload["generationConfig"]["maxOutputTokens"] == 4096
        assert "When effectPolicy is eligible" in system
        assert messages[-1] == {"role": "user", "content": body["messages"][-1]["content"]}
        assert body["requestId"] not in request.content.decode()
        for key in ("previousTouch", "previousInitiative"):
            text = body[key].get("text", body[key].get("publishedText"))
            assert any(text in m["content"] and m["role"] == "user" for m in messages)
        return httpx.Response(200, json=completion(reply) if provider == "groq" else gemini_completion(reply))

    with TestClient(
        app_factory(upstream, assistants={"default": {"provider": provider, "max_output_tokens": 4096}})
    ) as client:
        response = client.post("/v7/chat", json=body)
        assert response.status_code == 200 and response.json() == case["response"]
        assert client.post("/v7/chat", json=body).content == response.content
    assert len(calls) == 1


@pytest.mark.parametrize(
    "case",
    [
        case
        for case in CASES
        if case["response"]["appraisal"] != {"category": "neutral", "intensity": "low", "confidence": "clear"}
    ],
    ids=lambda case: case["name"],
)
def test_eligible_proposal_cannot_bypass_suppressed_policy(
    client_factory: Callable, completion: Callable[..., dict], case: dict[str, Any]
) -> None:
    body = {**case["request"], "effectPolicy": "suppressed"}
    reply = {key: value for key, value in case["response"].items() if key not in ("version", "requestId")}
    with client_factory(lambda _: httpx.Response(200, json=completion(reply))) as client:
        result = client.post("/v7/chat", json=body)
        assert result.status_code == 502 and result.json()["error"]["code"] == "invalid_model_response"


@pytest.mark.parametrize("source", ["previousTouch", "previousInitiative", "summary", "history", "appraisal"])
def test_semantics_do_not_become_memory_evidence(
    client_factory: Callable, completion: Callable[..., dict], source: str
) -> None:
    body = copy.deepcopy(CASES[0]["request"])
    body["messages"] = [
        {"role": "user", "content": "Старая история."},
        {"role": "assistant", "content": "Старый ответ."},
        {"role": "user", "content": "Зови меня Анна."},
    ]
    evidence = {
        "previousTouch": body["previousTouch"]["publishedText"],
        "previousInitiative": body["previousInitiative"]["text"],
        "summary": body["summary"]["text"],
        "history": body["messages"][0]["content"],
        "appraisal": "supportive",
    }[source]
    reply = {
        "text": "Хорошо, Анна.",
        "appraisal": {"category": "supportive", "intensity": "low", "confidence": "clear"},
        "memoryCandidates": [
            {"key": "user.display_name", "value": "Анна", "evidenceQuote": body["messages"][-1]["content"]},
            {"key": "user.favorite_topic", "value": "Звёзды", "evidenceQuote": evidence},
        ],
    }
    with client_factory(lambda _: httpx.Response(200, json=completion(reply))) as client:
        result = client.post("/v7/chat", json=body)
        assert result.status_code == 200
        assert result.json()["memoryCandidates"] == reply["memoryCandidates"][:1]
        assert result.json()["appraisal"] == reply["appraisal"]


@pytest.mark.parametrize(
    "extra",
    [
        {"friendship": 1000},
        {"consent": True},
        {"deltas": {"attention": -100}},
        {"evidence": "supportive"},
        {"category": ["supportive", "playful"]},
    ],
)
def test_eligible_never_accepts_numeric_or_multiple_appraisals(
    client_factory: Callable, completion: Callable[..., dict], extra: dict[str, Any]
) -> None:
    body = CASES[0]["request"]
    reply = {"text": "Спасибо.", "appraisal": {**CASES[0]["response"]["appraisal"], **extra}}
    with client_factory(lambda _: httpx.Response(200, json=completion(reply))) as client:
        result = client.post("/v7/chat", json=body)
        assert result.status_code == 502 and result.json()["error"]["code"] == "invalid_model_response"
