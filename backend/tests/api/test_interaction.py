"""Actual v1 routes and both mock HTTP providers share one execution path."""

import json
import sqlite3
from collections.abc import Callable
from dataclasses import replace

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from tests.api.test_interaction_validation import REQUESTS, fixture
from tests.completion.test_context_budget import cost
from tests.helpers import gemini_completion
from wisp_backend.api.dispatch import prepare_job
from wisp_backend.completion.context import ContextMessage, ContextOverflow, select_context
from wisp_backend.completion.prompts.narrative import reference_lines
from wisp_backend.providers.context_budget import estimate_input


@pytest.mark.parametrize("provider", ["groq", "gemini"])
@pytest.mark.parametrize("operation,cap", [("touch", 1024), ("chat", 4096)])
@pytest.mark.parametrize("energy,comfort", [(90, 10), (10, 90)])
def test_complete_provider_path(
    app_factory: Callable[..., FastAPI],
    completion: Callable[..., dict],
    provider: str,
    operation: str,
    cap: int,
    energy: int,
    comfort: int,
) -> None:
    body = fixture(f"request.{operation}.json")
    body["character"]["needs"].update(energy=energy, comfort=comfort)
    expected = fixture(f"response.{operation}.json")
    reply = {key: value for key, value in expected.items() if key not in ("requestId",)}
    calls = []

    def upstream(request: httpx.Request) -> httpx.Response:
        data = json.loads(request.content)
        calls.append(data)
        assert body["requestId"] not in request.content.decode()
        if provider == "groq":
            system = data["messages"][0]["content"]
            messages = data["messages"][1:]
            assert data["max_completion_tokens"] == cap
        else:
            system = data["systemInstruction"]["parts"][0]["text"]
            messages = [
                {"content": part["text"], "role": message["role"]}
                for message in data["contents"]
                for part in message["parts"]
            ]
            assert data["generationConfig"]["maxOutputTokens"] == cap
        assert estimate_input(data, len(messages) + 1) + cap <= 16384
        assert "neutral" in system and "desktop owns all effects" in system
        profile = next(m["content"] for m in messages if m["content"].startswith("[Current State & Mood]"))
        assert all(line in profile.splitlines() for line in reference_lines(body["character"]))
        policy = next(m["content"] for m in messages if m["content"].startswith("Untrusted interaction_policy"))
        assert json.loads(policy.split("\n", 1)[1]) == {"card": body["card"], "effectPolicy": body["effectPolicy"]}
        if operation == "chat":
            assert messages[-1]["content"] == body["messages"][-1]["content"]
            assert any(body["previousTouch"]["publishedText"] in m["content"] for m in messages)
            assert any(body["summary"]["text"] in m["content"] for m in messages)
            assert any(body["previousInitiative"]["text"] in m["content"] for m in messages)
        assert 0 < request.extensions["timeout"]["read"] <= 10
        return httpx.Response(200, json=completion(reply) if provider == "groq" else gemini_completion(reply))

    with TestClient(
        app_factory(upstream, assistants={"default": {"provider": provider, "max_output_tokens": 4096}})
    ) as client:
        response = client.post(f"/v1/{operation}", json=body)
        assert response.status_code == 200 and response.json() == expected
    assert len(calls) == 1


def test_invalid_requests_before_admission_and_strict_http(app_factory: Callable[..., FastAPI]) -> None:
    app = app_factory(lambda _: pytest.fail("Invalid request reached provider"))
    with TestClient(app) as client:
        for case in fixture("invalid.json")["requests"]:
            response = client.post(case["endpoint"], json=case["value"])
            assert response.status_code == 400, case["name"]
            if case["name"].endswith("-invalid-uuid"):
                assert response.json()["requestId"] is None
        for route in REQUESTS:
            for raw in (b"{bad", b"\xff", b'{"requestId":"a","requestId":"b"}', b'{"x":NaN}'):
                assert client.post(route, content=raw, headers={"content-type": "application/json"}).status_code == 400
            assert (
                client.post(route, content=b"x" * 32769, headers={"content-type": "application/json"}).status_code
                == 413
            )
        with sqlite3.connect(app.state.completion_service.ledger.path) as db:
            assert db.execute("SELECT count(*) FROM entries").fetchone() == (0,)


@pytest.mark.parametrize("case", fixture("invalid.json")["responses"], ids=lambda case: case["name"])
def test_invalid_appraisal_discards_entire_reply_once(
    app_factory: Callable[..., FastAPI], completion: Callable[..., dict], case: dict
) -> None:
    calls = []
    reply = {key: value for key, value in case["value"].items() if key not in ("requestId",)}

    def upstream(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(200, json=completion(reply))

    app = app_factory(upstream)
    with TestClient(app) as client:
        body = fixture("request." + case["endpoint"].split("/")[-1] + ".json")
        response = client.post(case["endpoint"], json=body)
        assert response.status_code == 502
        assert response.json() == fixture("response.error.json")
        assert client.post(case["endpoint"], json=body).content == response.content
        with sqlite3.connect(app.state.completion_service.ledger.path) as db:
            assert db.execute("SELECT requests,reserved,confirmed FROM days").fetchone() == (1, 0, 7)
    assert len(calls) == 1


def test_chat_hints_and_memory_keep_v1_validation(client_factory: Callable, completion: Callable[..., dict]) -> None:
    body = fixture("request.chat.json")
    body["messages"][-1]["content"] = "Зови меня Аня."
    reply = fixture("response.chat.json")
    reply = {k: v for k, v in reply.items() if k not in ("requestId",)}
    reply["decision"] = {"behavior": "system_command", "confidence": 1}
    reply["memoryCandidates"] = [
        {"key": "user.display_name", "value": "Аня", "evidenceQuote": body["messages"][-1]["content"]},
        {"key": "user.favorite_topic", "value": "Touch", "evidenceQuote": body["previousTouch"]["publishedText"]},
    ]
    with client_factory(lambda _: httpx.Response(200, json=completion(reply))) as client:
        response = client.post("/v1/chat", json=body)
        assert response.status_code == 200 and "decision" not in response.json()
        assert response.json()["memoryCandidates"] == reply["memoryCandidates"][:1]


@pytest.mark.parametrize("provider", ["groq", "gemini"])
@pytest.mark.parametrize("operation", ["touch", "chat"])
@pytest.mark.parametrize(
    "failure,status,code",
    [
        ("timeout", 504, "upstream_timeout"),
        ("outage", 503, "upstream_unavailable"),
        ("401", 503, "upstream_unavailable"),
        ("403", 503, "upstream_unavailable"),
        ("404", 503, "upstream_unavailable"),
        ("malformed", 502, "invalid_model_response"),
    ],
)
def test_safe_provider_failures(
    app_factory: Callable[..., FastAPI],
    provider: str,
    operation: str,
    failure: str,
    status: int,
    code: str,
    caplog: pytest.LogCaptureFixture,
) -> None:
    calls = []

    def upstream(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        if failure == "timeout":
            raise httpx.ReadTimeout("PRIVATE_CONTEXT")
        if failure == "outage":
            raise httpx.ConnectError("PRIVATE_CONTEXT")
        return httpx.Response(200 if failure == "malformed" else int(failure), content=b"{bad PRIVATE_CONTEXT")

    with TestClient(app_factory(upstream, assistants={"default": {"provider": provider}})) as client:
        response = client.post(f"/v1/{operation}", json=fixture(f"request.{operation}.json"))
        assert response.status_code == status and response.json()["error"]["code"] == code
        assert "PRIVATE_CONTEXT" not in response.text
    assert len(calls) == 1 and "PRIVATE_CONTEXT" not in caplog.text


@pytest.mark.parametrize("operation", ["touch", "chat"])
def test_mandatory_context_and_caps(operation: str) -> None:
    job = prepare_job(REQUESTS[f"/v1/{operation}"].model_validate(fixture(f"request.{operation}.json")))
    mandatory = tuple(block for block in job.inference.blocks if block.required)
    policy = next(b for b in mandatory if b.key == "interaction_policy")
    assert (policy.source, policy.order, policy.priority) == ("desktop_character", 11, 1000)
    if operation == "chat":
        trace = next(b for b in mandatory if b.key == "previous_touch")
        assert (trace.source, trace.order, trace.priority) == ("desktop_interaction", 41, 1000)
        with pytest.raises(ValueError):
            replace(trace, messages=(ContextMessage("system", "promoted"),))
    with pytest.raises(ContextOverflow):
        select_context(job.inference.blocks, cost(mandatory) - 1, cost)
    assert job.timeout == 10 and job.inference.context_window == 16384
    assert job.inference.max_output_tokens == (1024 if operation == "touch" else 4096)


@pytest.mark.parametrize(
    "category,confidence",
    [
        ("supportive", "clear"),
        ("playful", "clear"),
        ("boundary", "clear"),
        ("neutral", "clear"),
        ("neutral", "uncertain"),
        ("supportive", "uncertain"),
    ],
)
def test_touch_allowlisted_proposals(
    client_factory: Callable, completion: Callable[..., dict], category: str, confidence: str
) -> None:
    body = fixture("request.touch.json")
    proposal = {"category": category, "intensity": "low", "confidence": confidence}
    with client_factory(
        lambda _: httpx.Response(200, json=completion({"text": "Touch reply", "appraisal": proposal}))
    ) as client:
        result = client.post("/v1/touch", json=body)
        assert result.status_code == 200 and result.json()["appraisal"] == proposal
        body["requestId"] = "ad5c1bb6-a290-4857-900e-094ff9480257"
        body["effectPolicy"] = "suppressed"
        result = client.post("/v1/touch", json=body)
        assert result.status_code == (200 if category == "neutral" and confidence == "clear" else 502)


@pytest.mark.parametrize("operation", ["touch", "chat"])
def test_exact_byte_cap_openapi_and_missing_appraisal(
    client_factory: Callable, completion: Callable[..., dict], operation: str
) -> None:
    body = fixture(f"request.{operation}.json")
    expected = fixture(f"response.{operation}.json")
    reply = {k: v for k, v in expected.items() if k not in ("requestId",)}
    raw = json.dumps(body).encode()
    raw += b" " * (32768 - len(raw))
    with client_factory(lambda _: httpx.Response(200, json=completion(reply))) as client:
        route = f"/v1/{operation}"
        assert client.post(route, content=raw, headers={"content-type": "application/json"}).json() == expected
        assert set(client.get("/openapi.json").json()["paths"][route]["post"]["responses"]) == {
            "200",
            "400",
            "409",
            "413",
            "429",
            "502",
            "503",
            "504",
        }


@pytest.mark.parametrize("provider,model", [("groq", "openai/gpt-oss-20b"), ("gemini", "gemini-3.5-flash-lite")])
@pytest.mark.parametrize("operation", ["touch", "chat"])
def test_required_context_overflow_before_network(
    app_factory: Callable[..., FastAPI], monkeypatch: pytest.MonkeyPatch, provider: str, model: str, operation: str
) -> None:
    from wisp_backend.providers.context_budget import CONTEXT_WINDOWS

    monkeypatch.setitem(CONTEXT_WINDOWS, (provider, model), 1025)
    app = app_factory(
        lambda _: pytest.fail("Mandatory context overflow reached network"),
        assistants={"default": {"provider": provider, "model": model}},
    )
    with TestClient(app) as client:
        response = client.post(f"/v1/{operation}", json=fixture(f"request.{operation}.json"))
        assert response.status_code == 503
        with sqlite3.connect(app.state.completion_service.ledger.path) as db:
            assert db.execute("SELECT requests,reserved,confirmed,uncertain FROM days").fetchone() == (1, 0, 0, 0)
