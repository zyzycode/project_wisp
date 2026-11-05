"""Finite text-discussion context, separate subjects and atomic optional provenance."""

import json
from collections.abc import Callable
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError
from tests.helpers import CONTRACT_FIXTURES, gemini_completion
from wisp_backend.api.dispatch import prepare_job
from wisp_backend.api.schemas.events import EventRequest
from wisp_backend.api.schemas.interaction import InteractionChatRequest, InteractionTouchRequest
from wisp_backend.api.schemas.music_interest import MusicTopicContext
from wisp_backend.api.schemas.observation import ObservationRequest
from wisp_backend.api.schemas.summary import SummaryRequest
from wisp_backend.completion.context import ContextBlock, render_messages, select_context

ROOT = CONTRACT_FIXTURES / "desktop-backend-v1"
MUSIC = ROOT / "music-topic"


def read(name: str) -> dict[str, Any]:
    return json.loads((ROOT / name).read_bytes())


@pytest.mark.parametrize("case", json.loads((MUSIC / "invalid.json").read_bytes()), ids=lambda c: c["name"])
def test_strict_invalid_shared_music(case: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        MusicTopicContext.model_validate(case["value"])
    with pytest.raises(ValidationError):
        InteractionChatRequest.model_validate({**read("request.valid.json"), "musicTopic": case["value"]})


@pytest.mark.parametrize("case", json.loads((MUSIC / "valid.json").read_bytes()), ids=lambda c: c["name"])
def test_music_is_ordinary_chat_only(case: dict[str, Any]) -> None:
    value = case["value"]
    assert MusicTopicContext.model_validate(value).model_dump(exclude_none=True) == value
    assert InteractionChatRequest.model_validate({**read("request.valid.json"), "musicTopic": value}).musicTopic
    body = read("request.valid.json")
    event = {key: body[key] for key in ["requestId", "stream", "locale", "character", "memory"]}
    event["event"] = {"type": "social_bid_started", "occurredAt": "2026-11-05T10:00:00.000Z"}
    for schema, request in [
        (EventRequest, event),
        (InteractionTouchRequest, read("request.touch.json")),
        (ObservationRequest, read("observation/request.valid.json")),
        (SummaryRequest, {}),
    ]:
        with pytest.raises(ValidationError):
            schema.model_validate({**request, "musicTopic": value})


def test_optional_music_never_evicts_baseline_or_claims_audio_experience() -> None:
    body = read("request.valid.json")
    baseline = prepare_job(InteractionChatRequest.model_validate(body)).inference.blocks
    body["musicTopic"] = json.loads((MUSIC / "valid.json").read_bytes())[1]["value"]
    enriched = prepare_job(InteractionChatRequest.model_validate(body)).inference.blocks
    block = next(item for item in enriched if item.key == "music_topic")
    assert (block.priority, block.order, block.required, block.source) == (20, 47, False, "desktop_music_topic")
    assert block.messages[0].role == "user"
    assert "text discussion only" in block.server_instructions
    assert "Never infer hearing music" in block.server_instructions
    assert "possibly about a different topic" in block.server_instructions
    assert tuple(item for item in enriched if item.key != "music_topic") == baseline

    def size(blocks: tuple[ContextBlock, ...]) -> int:
        return len(json.dumps(render_messages(blocks), ensure_ascii=False).encode("utf-8"))

    assert select_context(enriched, size(baseline), size) == select_context(baseline, size(baseline), size)
    assert any(item.key == "music_topic" for item in select_context(enriched, size(enriched), size))


def test_topic_precedence_omits_music_without_changing_existing_topic_instructions() -> None:
    body = read("request.valid.json")
    body["dialogueTopic"] = {"mode": "reply", "text": "A current topic", "statedAt": "2026-11-05T10:00:00.000Z"}
    baseline = prepare_job(InteractionChatRequest.model_validate(body)).inference.blocks
    body["musicTopic"] = json.loads((MUSIC / "valid.json").read_bytes())[0]["value"]
    assert prepare_job(InteractionChatRequest.model_validate(body)).inference.blocks == baseline


@pytest.mark.parametrize("provider", ["openai", "gemini"])
def test_real_chat_route_dispatches_once_and_conflicts_on_changed_music(
    app_factory: Callable[..., FastAPI], chat_completion: Callable[..., dict[str, Any]], provider: str
) -> None:
    calls = []

    def upstream(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        assert b"text_discussion" in request.content and b"jazz" in request.content
        reply = {
            "text": "A music discussion.",
            "appraisal": {"category": "neutral", "intensity": "low", "confidence": "clear"},
        }
        return httpx.Response(200, json=gemini_completion(reply) if provider == "gemini" else chat_completion(reply))

    body = read("request.valid.json")
    body["musicTopic"] = json.loads((MUSIC / "valid.json").read_bytes())[0]["value"]
    with TestClient(app_factory(upstream, assistants={"default": {"provider": provider}})) as client:
        first = client.post("/v1/chat", json=body)
        assert first.status_code == 200
        assert client.post("/v1/chat", json=body).json() == first.json()
        changed = {**body, "musicTopic": {**body["musicTopic"], "topic": "rock"}}
        assert client.post("/v1/chat", json=changed).status_code == 409
        assert len(calls) == 1


@pytest.mark.parametrize("failure,status", [("outage", 503), ("timeout", 504), ("malformed", 502)])
def test_existing_failure_contracts_keep_music_optional_and_hide_provider_details(
    app_factory: Callable[..., FastAPI], failure: str, status: int
) -> None:
    calls = []

    def upstream(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        if failure == "timeout":
            raise httpx.ReadTimeout("private-music-provider-detail", request=request)
        if failure == "malformed":
            return httpx.Response(200, json={"private-music-provider-detail": "not a completion"})
        return httpx.Response(503, text="private-music-provider-detail")

    body = read("request.valid.json")
    body["musicTopic"] = json.loads((MUSIC / "valid.json").read_bytes())[0]["value"]
    with TestClient(app_factory(upstream)) as client:
        result = client.post("/v1/chat", json=body)
        assert result.status_code == status
        assert "private-music-provider-detail" not in result.text
        assert len(calls) == 1
