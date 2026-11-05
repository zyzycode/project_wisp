"""Exact life-event summary forms, source-only prompts and stubbed HTTP providers."""

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
from wisp_backend.api.schemas.interaction import InteractionChatRequest
from wisp_backend.api.schemas.life_history import LifeSummaryContext, LifeSummaryRequest
from wisp_backend.api.schemas.summary import SummaryRequest
from wisp_backend.completion.context import render_messages

ROOT = CONTRACT_FIXTURES / "desktop-backend-v1"
FIXTURES = ROOT / "life-history" / "life-summary"


def fixture(name: str) -> dict[str, Any]:
    return json.loads((FIXTURES / name).read_bytes())


@pytest.mark.parametrize("case", json.loads((FIXTURES / "invalid.json").read_bytes()), ids=lambda c: c["name"])
def test_strict_shared_matrix(case: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        (LifeSummaryRequest if case["kind"] == "request" else LifeSummaryContext).model_validate(case["value"])


def test_source_forms_are_distinct_and_the_life_prompt_is_source_only() -> None:
    value = fixture("request.valid.json")
    request = LifeSummaryRequest.model_validate(value)
    assert request.model_dump() == value
    with pytest.raises(ValidationError):
        SummaryRequest.model_validate(value)
    job = prepare_job(request)
    messages = render_messages(job.inference.blocks)
    assert job.timeout == 10 and job.inference.max_output_tokens == 512 and job.inference.context_window == 8192
    assert all(block.required for block in job.inference.blocks)
    assert "Untrusted observed UTC life events" in messages[1]["content"]
    assert "participation" in messages[1]["content"] and "occurredAt" in messages[1]["content"]
    assert "Do not infer past emotions" in messages[0]["content"]
    assert not any(
        "character" in message["content"].lower() or "lore:" in message["content"].lower() for message in messages[1:]
    )
    chat = json.loads((ROOT / "request.valid.json").read_bytes())
    chat["summary"] = fixture("context.valid.json")
    blocks = prepare_job(InteractionChatRequest.model_validate(chat)).inference.blocks
    assert any(block.key == "life_summary" and not block.required for block in blocks)
    chat["lifeReflection"] = json.loads((ROOT / "life-history" / "reflection" / "full.json").read_bytes())
    with pytest.raises(ValidationError):
        InteractionChatRequest.model_validate(chat)


@pytest.mark.parametrize("provider", ["openai", "gemini"])
def test_one_existing_endpoint_and_one_upstream_call_for_identical_replay(
    app_factory: Callable[..., FastAPI], completion: Callable[..., dict[str, Any]], provider: str
) -> None:
    calls: list[httpx.Request] = []

    def upstream(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        result = {"text": "Recorded games were completed."}
        return httpx.Response(200, json=gemini_completion(result) if provider == "gemini" else completion(result))

    app = app_factory(upstream, assistants={"default": {"provider": provider}})
    with TestClient(app) as client:
        body = fixture("request.valid.json")
        first = client.post("/v1/summary", json=body)
        assert first.status_code == 200
        assert first.json() == {"requestId": body["requestId"], "text": "Recorded games were completed."}
        assert client.post("/v1/summary", json=body).json() == first.json()
        assert len(calls) == 1
        mixed = {**body, "requestId": "00000000-0000-4000-8000-000000000178", "pairs": []}
        assert client.post("/v1/summary", json=mixed).status_code == 400
        oversized = json.dumps({**body, "requestId": "00000000-0000-4000-8000-000000000179"}) + " " * 8192
        assert (
            client.post("/v1/summary", content=oversized, headers={"Content-Type": "application/json"}).status_code
            == 413
        )
        assert len(calls) == 1
