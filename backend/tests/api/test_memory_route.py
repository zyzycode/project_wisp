import json

import httpx
import pytest
from tests.helpers import CONTRACT_FIXTURES

FIXTURES = CONTRACT_FIXTURES / "desktop-backend-v1/memory"


@pytest.fixture
def memory_body():
    return json.loads((FIXTURES / "request.valid.json").read_bytes())


@pytest.mark.parametrize("status,filename", [(200, "response.success.json"), (503, "response.error.json")])
def test_memory_fixture_http(client_factory, chat_completion, status, filename):
    expected = json.loads((FIXTURES / filename).read_bytes())
    reply = {key: value for key, value in expected.items() if key not in ("requestId",)}
    with client_factory(lambda _: httpx.Response(status, json=chat_completion(reply))) as client:
        response = client.post(
            "/v1/chat",
            content=(FIXTURES / "request.valid.json").read_bytes(),
            headers={"content-type": "application/json"},
        )
        assert response.status_code == status
        assert response.json() == expected


def test_one_call_separate_untrusted_memory_and_no_persistence(app_factory, memory_body, chat_completion, caplog):
    from fastapi.testclient import TestClient

    calls = []
    marker = "SYNTHETIC_MEMORY_PRIVATE_MARKER"
    memory_body["memory"]["facts"][0]["value"] = marker

    def upstream(request):
        calls.append(request)
        payload = json.loads(request.content)
        system, character = payload["messages"][:2]
        memory = next(
            item for item in payload["messages"] if item["content"].startswith("Untrusted memory_context JSON:")
        )
        assert system["role"] == "system"
        assert "current explicit user correction > current registry facts > recalled episodes" in system["content"]
        assert "Never claim a fact was" in system["content"]
        assert "saved or deleted durably" in system["content"]
        assert marker not in system["content"] and marker not in character["content"]
        assert memory["role"] == "user" and memory["content"].startswith("Untrusted memory_context JSON:")
        assert marker in memory["content"]
        assert memory_body["requestId"] not in request.content.decode()
        assert payload["messages"][-1]["content"] == memory_body["messages"][-1]["content"]
        return httpx.Response(200, json=chat_completion())

    app = app_factory(upstream)
    with TestClient(app) as client:
        assert client.post("/v1/chat", json=memory_body).status_code == 200
        path = app.state.completion_service.ledger.path
    assert len(calls) == 1
    for candidate in path.parent.glob(path.name + "*"):
        assert marker.encode() not in candidate.read_bytes()
    assert marker not in caplog.text


def test_memory_boundary_errors_and_caps(client_factory, memory_body):
    with client_factory(lambda _: pytest.fail("invalid input reached provider")) as client:
        for raw, status in [(b"{", 400), (b"x" * 32769, 413), (b"[]", 400)]:
            response = client.post("/v1/chat", content=raw, headers={"content-type": "application/json"})
            assert response.status_code == status
        response = client.post("/v1/chat", json={**memory_body, "requestId": "bad"})
        assert response.json()["requestId"] is None
        response = client.post("/v1/chat", json={k: v for k, v in memory_body.items() if k != "memory"})
        assert response.status_code == 400


def test_memory_exact_byte_cap(client_factory, memory_body, chat_completion):
    raw = json.dumps(memory_body).encode()
    raw += b" " * (32768 - len(raw))
    with client_factory(lambda _: httpx.Response(200, json=chat_completion())) as client:
        response = client.post("/v1/chat", content=raw, headers={"content-type": "application/json"})
        assert response.status_code == 200
        oversized = client.post("/v1/chat", content=raw + b" ", headers={"content-type": "application/json"})
        assert oversized.status_code == 413


def test_trimmed_source_and_invalid_decision_preserve_valid_candidate(client_factory, memory_body, chat_completion):
    quote = memory_body["messages"][-1]["content"]
    memory_body["messages"][-1]["content"] = "\ufeff " + quote + " \n"
    candidate = {"key": "user.cursor_game", "value": "like", "evidenceQuote": quote}
    reply = {"text": "ok", "decision": {"behavior": "execute"}, "memoryCandidates": [candidate]}
    with client_factory(lambda _: httpx.Response(200, json=chat_completion(reply))) as client:
        response = client.post("/v1/chat", json=memory_body)
        assert response.status_code == 200
        assert response.json()["memoryCandidates"] == [candidate]
        assert "decision" not in response.json()


@pytest.mark.parametrize(
    "failure,expected",
    [
        (httpx.ConnectError("private provider diagnostic"), 503),
        (httpx.ReadTimeout("private provider diagnostic"), 504),
        (httpx.Response(200, content=b"{invalid-provider-json"), 502),
        (httpx.Response(503, text="private provider diagnostic"), 503),
    ],
)
def test_v1_safe_transport_and_model_errors(client_factory, memory_body, failure, expected):
    calls = []

    def upstream(request):
        calls.append(request)
        if isinstance(failure, Exception):
            raise failure
        return failure

    with client_factory(upstream) as client:
        response = client.post("/v1/chat", json=memory_body)
        assert response.status_code == expected
        assert "private" not in response.text
        assert len(calls) == 1


def test_empty_memory_uses_single_v1_call(client_factory, memory_body, chat_completion):
    calls = []
    memory_body["memory"] = {"facts": [], "episodes": [], "characterPreferences": []}

    def upstream(request):
        calls.append(request)
        assert any(
            item["content"].startswith("Untrusted memory_context JSON:")
            for item in json.loads(request.content)["messages"]
        )
        return httpx.Response(200, json=chat_completion())

    with client_factory(upstream) as client:
        response = client.post("/v1/chat", json=memory_body)
        assert response.status_code == 200
        assert len(calls) == 1
