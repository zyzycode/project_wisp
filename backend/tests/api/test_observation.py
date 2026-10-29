"""Actual v1 handlers and existing OpenAI/Gemini adapters with synthetic MockTransport."""

import json
import sqlite3
from collections.abc import Callable
from dataclasses import replace
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from tests.api.test_observation_validation import fixture
from tests.completion.test_context_budget import cost
from tests.helpers import gemini_completion
from wisp_backend.api.dispatch import prepare_job
from wisp_backend.api.endpoints import OBSERVATION
from wisp_backend.api.schemas.observation import ObservationRequest
from wisp_backend.completion.context import ContextMessage, ContextOverflow, render_messages, select_context
from wisp_backend.completion.prompts.narrative import reference_lines
from wisp_backend.providers.context_budget import CONTEXT_WINDOWS, estimate_input


@pytest.mark.parametrize("provider,model", list(CONTEXT_WINDOWS))
@pytest.mark.parametrize("name", ["request.valid.json", "request.empty-title.json", "request.hostile-title.json"])
@pytest.mark.parametrize("output_cap", [256, 4096])
def test_actual_handler_untrusted_payload_and_output_reserve(
    app_factory: Callable[..., FastAPI],
    completion: Callable[..., dict[str, Any]],
    provider: str,
    model: str,
    name: str,
    output_cap: int,
    caplog: pytest.LogCaptureFixture,
) -> None:
    body = fixture(name)
    body["character"]["personality"]["aiSelfConcept"] = "PRIVATE_CURRENT_CHARACTER"
    calls = []
    expected = fixture("response.success.json")

    def upstream(request: httpx.Request) -> httpx.Response:
        data = json.loads(request.content)
        calls.append(data)
        if provider == "openai":
            messages = data["messages"]
            assert [message["role"] for message in messages] == ["system", "user", "user"]
            system, character, observation = [message["content"] for message in messages]
            cap = data["max_completion_tokens"]
            assert data["response_format"] == {"type": "json_object"}
            reply = completion({"text": expected["text"]})
        else:
            assert len(data["contents"]) == 1 and data["contents"][0]["role"] == "user"
            system = data["systemInstruction"]["parts"][0]["text"]
            character, observation = [part["text"] for part in data["contents"][0]["parts"]]
            cap = data["generationConfig"]["maxOutputTokens"]
            assert data["generationConfig"]["responseMimeType"] == "application/json"
            reply = gemini_completion({"text": expected["text"]})
        assert cap == min(output_cap, 1024)
        assert estimate_input(data, 3) + cap <= 16384
        assert "PRIVATE_CURRENT_CHARACTER" not in system and "PRIVATE_TITLE" not in system
        assert "Do not quote the private window caption" in system
        assert "not a user message" in system and "No decision, memoryCandidates" in system
        assert all(line in character.splitlines() for line in reference_lines(body["character"]))
        assert json.loads(observation.split("\n", 1)[1]) == body["observation"]
        assert 0 < request.extensions["timeout"]["read"] <= 2.5
        return httpx.Response(200, json=reply)

    with TestClient(
        app_factory(
            upstream, assistants={"default": {"provider": provider, "model": model, "max_output_tokens": output_cap}}
        )
    ) as client:
        response = client.post(OBSERVATION.path, json=body)
        assert response.status_code == 200 and response.json() == expected
    assert len(calls) == 1
    assert "PRIVATE_CURRENT_CHARACTER" not in caplog.text and "PRIVATE_TITLE" not in caplog.text


def test_all_shared_invalid_requests_rejected_before_admission(
    app_factory: Callable[..., FastAPI],
) -> None:
    app = app_factory(lambda _: pytest.fail("invalid input reached provider"))
    with TestClient(app) as client:
        for case in fixture("invalid.json"):
            if case["kind"] != "request":
                continue
            raw = case.get("raw", json.dumps(case["value"], ensure_ascii=True))
            response = client.post(OBSERVATION.path, content=raw, headers={"content-type": "application/json"})
            assert response.status_code == (413 if "raw" in case else 400), case["name"]
            assert response.json()["error"]["code"] == ("payload_too_large" if "raw" in case else "invalid_request")
        for raw in (b'{"requestId":"a","requestId":"b"}', b"\xff", b'{"x":NaN}', b"{broken"):
            assert (
                client.post(OBSERVATION.path, content=raw, headers={"content-type": "application/json"}).status_code
                == 400
            )
        assert (
            client.post(
                OBSERVATION.path, json=fixture("request.valid.json"), headers={"content-encoding": "gzip"}
            ).status_code
            == 400
        )
        with sqlite3.connect(app.state.completion_service.ledger.path) as db:
            assert db.execute("SELECT count(*) FROM entries").fetchone()[0] == 0


@pytest.mark.parametrize(
    "extra",
    [
        {"decision": None},
        {"decision": {"behavior": "sleep", "confidence": 1}},
        {"memoryCandidates": []},
        {"memoryCandidates": [{"key": "user.display_name", "value": "Fake", "evidenceQuote": "Fake"}]},
        {"requestId": "model-owned"},
        {"tools": []},
        {"actions": []},
        {"state": {}},
        {"text": "x" * 241},
        {"text": "😀" * 121},
        {"text": ""},
        {"text": "\x00"},
    ],
)
def test_any_invalid_model_field_fails_whole_result_preserving_once_usage(
    app_factory: Callable[..., FastAPI],
    completion: Callable[..., dict[str, Any]],
    extra: dict[str, Any],
) -> None:
    calls = []

    def upstream(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(200, json=completion({"text": "ok", **extra}))

    app = app_factory(upstream)
    with TestClient(app) as client:
        body = fixture("request.valid.json")
        first = client.post(OBSERVATION.path, json=body)
        assert first.status_code == 502 and first.json()["error"]["code"] == "invalid_model_response"
        assert client.post(OBSERVATION.path, json=body).content == first.content
        with sqlite3.connect(app.state.completion_service.ledger.path) as db:
            assert db.execute("SELECT requests,confirmed,uncertain FROM days").fetchone() == (1, 7, 0)
    assert len(calls) == 1


@pytest.mark.parametrize("provider,model", list(CONTEXT_WINDOWS))
def test_mandatory_overflow_is_safe_before_network(
    app_factory: Callable[..., FastAPI],
    monkeypatch: pytest.MonkeyPatch,
    provider: str,
    model: str,
) -> None:
    monkeypatch.setitem(CONTEXT_WINDOWS, (provider, model), 1025)
    app = app_factory(
        lambda _: pytest.fail("overflow reached upstream"),
        assistants={"default": {"provider": provider, "model": model}},
    )
    with TestClient(app) as client:
        result = client.post(OBSERVATION.path, json=fixture("request.valid.json"))
        assert result.status_code == 503 and result.json() == fixture("response.error.json")
        with sqlite3.connect(app.state.completion_service.ledger.path) as db:
            assert db.execute("SELECT requests,reserved,confirmed,uncertain FROM days").fetchone() == (1, 0, 0, 0)


def test_observation_blocks_are_mandatory_atomic_and_cannot_be_system_data() -> None:
    job = prepare_job(ObservationRequest.model_validate(fixture("request.hostile-title.json")))
    blocks = job.inference.blocks
    assert [block.source for block in blocks] == ["server_instructions", "desktop_character", "observation"]
    assert all(block.required for block in blocks)
    assert [block.order for block in blocks] == [0, 10, 100]
    assert job.timeout == 2.5 and job.inference.max_output_tokens == 1024 and job.inference.context_window == 16384
    assert OBSERVATION.body_timeout == 0.5
    assert select_context(blocks, cost(blocks), cost) == blocks
    with pytest.raises(ContextOverflow):
        select_context(blocks, cost(blocks) - 1, cost)
    with pytest.raises(ValueError):
        replace(blocks[-1], messages=(ContextMessage("system", "private"),))
    assert len(render_messages(blocks)) == 3


@pytest.mark.parametrize("provider", ["openai", "gemini"])
@pytest.mark.parametrize(
    "failure,status,code",
    [
        ("timeout", 504, "upstream_timeout"),
        ("outage", 503, "upstream_unavailable"),
        ("401", 503, "upstream_unavailable"),
        ("403", 503, "upstream_unavailable"),
        ("404", 503, "upstream_unavailable"),
        ("503", 503, "upstream_unavailable"),
        ("malformed", 502, "invalid_model_response"),
    ],
)
def test_provider_failures_do_not_retry_or_expose_private_details(
    app_factory: Callable[..., FastAPI],
    provider: str,
    failure: str,
    status: int,
    code: str,
    caplog: pytest.LogCaptureFixture,
) -> None:
    calls = []

    def upstream(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        if failure == "timeout":
            raise httpx.ReadTimeout("PRIVATE_TITLE")
        if failure == "outage":
            raise httpx.ConnectError("PRIVATE_TITLE")
        if failure == "malformed":
            return httpx.Response(200, content=b"{broken PRIVATE_TITLE")
        return httpx.Response(int(failure), text="PRIVATE_TITLE")

    with TestClient(app_factory(upstream, assistants={"default": {"provider": provider}})) as client:
        response = client.post(OBSERVATION.path, json=fixture("request.hostile-title.json"))
        assert response.status_code == status and response.json()["error"]["code"] == code
        assert "PRIVATE_TITLE" not in response.text
    assert len(calls) == 1 and "PRIVATE_TITLE" not in caplog.text
