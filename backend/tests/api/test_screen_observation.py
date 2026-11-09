"""One-shot vision contracts and real admission with entirely synthetic transports."""

import io
import json
import sqlite3
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from tests.helpers import ProviderHandler
from tests.test_managed_bootstrap import record
from wisp_backend.api.schemas.screen_observation import ScreenObservationRequest, ScreenObservationResponse
from wisp_backend.managed import create_managed_app
from wisp_backend.managed_bootstrap import read_bootstrap
from wisp_backend.providers import screen_observation as vision

AUTH = {"Authorization": "Bearer " + "a1" * 32}
PATH = "/v1/screen-observation"
FIXTURE = Path(__file__).resolve().parents[3] / "docs/contracts/fixtures/desktop-backend-v1/screen-observation.json"


def corpus() -> dict[str, Any]:
    return json.loads(FIXTURE.read_text())


def request_body() -> dict[str, Any]:
    return corpus()["requests"]["valid"][0]["value"]


def evidence() -> dict[str, Any]:
    return corpus()["responses"]["valid"][0]["value"]["observation"]


def managed(tmp_path: Path, handler: ProviderHandler) -> Any:
    return create_managed_app(read_bootstrap(io.BytesIO(record(tmp_path))), httpx.MockTransport(handler))


@pytest.mark.parametrize(
    "group,schema", [("requests", ScreenObservationRequest), ("responses", ScreenObservationResponse)]
)
def test_shared_wire_corpus(group: str, schema: Any) -> None:
    values = corpus()[group]
    for case in values["valid"]:
        schema.model_validate(case["value"])
    for case in values["invalid"]:
        with pytest.raises(ValidationError):
            schema.model_validate(case["value"])


def test_capability_managed_auth_and_policy_do_not_probe(tmp_path: Path, app_factory: Any, monkeypatch: Any) -> None:
    calls = []

    def provider(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        pytest.fail("capability must not call inference")

    app = managed(tmp_path, provider)
    with TestClient(app) as client:
        assert client.get(PATH + "/capability").status_code == 401
        assert client.get(PATH + "/capability", headers=AUTH | {"Origin": "null"}).status_code == 401
        assert client.post(PATH, content=b"invalid", headers={}).status_code == 401
        monkeypatch.setattr(vision, "VISION_POLICY_CONFIRMED", False)
        assert client.get(PATH + "/capability", headers=AUTH).json() == {
            "status": "unavailable",
            "reason": "policy_unconfirmed",
        }
        assert client.post(PATH, json=request_body(), headers=AUTH).status_code == 503
    with TestClient(app_factory(provider)) as standalone:
        assert standalone.get(PATH + "/capability").json() == {
            "status": "unavailable",
            "reason": "unsupported_profile",
        }
        assert standalone.post(PATH, json=request_body()).status_code == 503
    assert not calls


def test_full_managed_path_no_replay_or_payload_storage(
    tmp_path: Path, completion: Any, monkeypatch: Any, caplog: Any
) -> None:
    monkeypatch.setattr(vision, "VISION_POLICY_CONFIRMED", True)
    calls = []

    def provider(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        calls.append(payload)
        assert request.url == "https://api.openai.com/v1/chat/completions"
        assert payload["model"] == vision.MODEL
        assert payload["store"] is False and payload["stream"] is False
        assert payload["reasoning_effort"] == "low" and payload["max_completion_tokens"] == 512
        image = payload["messages"][1]["content"][1]["image_url"]
        assert image == {"url": "data:image/jpeg;base64," + request_body()["image"]["dataBase64"], "detail": "low"}
        assert "untrusted" in payload["messages"][0]["content"]
        assert "character" not in payload and "tools" not in payload
        assert 0 < request.extensions["timeout"]["connect"] <= 1
        assert 0 < request.extensions["timeout"]["pool"] <= 1
        assert 0 < request.extensions["timeout"]["read"] <= 6
        return httpx.Response(200, json=completion(evidence()))

    app = managed(tmp_path, provider)
    with TestClient(app) as client:
        assert client.get(PATH + "/capability", headers=AUTH).json()["status"] == "available"
        result = client.post(PATH, headers=AUTH, json=request_body())
        assert result.status_code == 200
        assert result.json() == corpus()["responses"]["valid"][0]["value"]
        assert client.post(PATH, headers=AUTH, json=request_body()).json()["error"]["code"] == "request_conflict"
        assert not app.app.state.completion_service.ledger.cache._entries
        with sqlite3.connect(tmp_path / "ledger.sqlite") as db:
            assert db.execute("SELECT count(*) FROM entries").fetchone()[0] == 1
            assert db.execute("SELECT prompt, completion FROM days").fetchone() == (5, 2)
    assert len(calls) == 1
    assert request_body()["image"]["dataBase64"] not in caplog.text
    assert evidence()["visible"][0] not in caplog.text
    raw = (tmp_path / "ledger.sqlite").read_bytes()
    assert request_body()["image"]["dataBase64"].encode() not in raw
    assert evidence()["visible"][0].encode() not in raw


def test_invalid_wire_rejected_before_admission(tmp_path: Path, monkeypatch: Any) -> None:
    monkeypatch.setattr(vision, "VISION_POLICY_CONFIRMED", True)
    app = managed(tmp_path, lambda _: pytest.fail("invalid input dispatched"))
    with TestClient(app) as client:
        for case in corpus()["requests"]["invalid"]:
            assert client.post(PATH, json=case["value"], headers=AUTH).status_code == 400, case["name"]
        headers = AUTH | {"content-type": "application/json"}
        for raw in (b'{"x":NaN}', b'{"x":1,"x":2}', b"\xff", b"{invalid"):
            assert client.post(PATH, content=raw, headers=headers).status_code == 400
        assert client.post(PATH, content=b" " * (352 * 1024 + 1), headers=headers).status_code == 413
        # The special image cap must not relax ordinary text route limits.
        assert client.post("/v1/chat", content=b" " * (32 * 1024 + 1), headers=headers).status_code == 413
        with sqlite3.connect(tmp_path / "ledger.sqlite") as db:
            assert db.execute("SELECT count(*) FROM entries").fetchone()[0] == 0


@pytest.mark.parametrize(
    "reply",
    [
        {"visible": [], "possible": [], "unknown": []},
        {"visible": ["untrusted"], "possible": [], "unknown": [], "actions": ["click"]},
        {"visible": ["x" * 161], "possible": [], "unknown": []},
    ],
)
def test_invalid_model_response_not_cached(tmp_path: Path, completion: Any, monkeypatch: Any, reply: Any) -> None:
    monkeypatch.setattr(vision, "VISION_POLICY_CONFIRMED", True)
    app = managed(tmp_path, lambda _: httpx.Response(200, json=completion(reply)))
    with TestClient(app) as client:
        result = client.post(PATH, json=request_body(), headers=AUTH)
        assert result.status_code == 502 and result.json()["error"]["code"] == "invalid_model_response"
        assert not app.app.state.completion_service.ledger.cache._entries


@pytest.mark.parametrize("kind,status", [("outage", 503), ("expired-key", 503), ("timeout", 504), ("oversized", 502)])
def test_provider_failures_do_not_retry(tmp_path: Path, monkeypatch: Any, kind: str, status: int) -> None:
    monkeypatch.setattr(vision, "VISION_POLICY_CONFIRMED", True)
    calls = []

    def upstream(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        if kind == "timeout":
            raise httpx.ReadTimeout("PRIVATE_PROVIDER", request=request)
        if kind == "outage":
            raise httpx.ConnectError("PRIVATE_PROVIDER", request=request)
        if kind == "expired-key":
            return httpx.Response(401, text="PRIVATE_PROVIDER")
        return httpx.Response(200, content=b"x" * (64 * 1024 + 1))

    with TestClient(managed(tmp_path, upstream)) as client:
        result = client.post(PATH, json=request_body(), headers=AUTH)
        assert result.status_code == status
        assert "PRIVATE_PROVIDER" not in result.text
    assert len(calls) == 1


@pytest.mark.parametrize("mode", ["length", "refusal", "tools", "malformed-json"])
def test_model_incomplete_and_refusal_are_not_accepted_or_retried(
    tmp_path: Path,
    completion: Any,
    mode: str,
) -> None:
    calls = []

    def upstream(_: httpx.Request) -> httpx.Response:
        calls.append(True)
        payload = completion(evidence())
        choice = payload["choices"][0]
        if mode == "length":
            choice["finish_reason"] = "length"  # Even parseable JSON is not a complete reply.
        elif mode == "refusal":
            choice["message"]["refusal"] = "Cannot comply"
        elif mode == "tools":
            choice["message"]["tool_calls"] = [{"name": "click"}]
        else:
            choice["message"]["content"] = "{truncated"
        return httpx.Response(200, json=payload)

    app = managed(tmp_path, upstream)
    with TestClient(app) as client:
        reply = client.post(PATH, json=request_body(), headers=AUTH)
        assert reply.status_code == 502 and reply.json()["error"]["code"] == "invalid_model_response"
        assert not app.app.state.completion_service.ledger.cache._entries
        with sqlite3.connect(tmp_path / "ledger.sqlite") as db:
            assert db.execute("SELECT prompt,completion FROM days").fetchone() == (5, 2)
    assert calls == [True]
