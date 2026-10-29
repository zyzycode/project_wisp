import json

import httpx
import pytest
from tests.helpers import CONTRACT_FIXTURES

FIXTURES = CONTRACT_FIXTURES / "desktop-backend-v1/events"


def fixture(name):
    return json.loads((FIXTURES / name).read_bytes())


@pytest.mark.parametrize(
    "route,request_file,response_file,status",
    [
        ("/v1/events", "request.game.json", "response.event.success.json", 200),
        ("/v1/events", "request.game.json", "response.error.json", 503),
        ("/v1/chat", "request.chat.json", "response.chat.success.json", 200),
    ],
)
def test_v1_shared_fixtures_http(client_factory, completion, route, request_file, response_file, status):
    expected = fixture(response_file)
    reply = {key: value for key, value in expected.items() if key not in ("requestId",)}
    with client_factory(lambda _: httpx.Response(status, json=completion(reply))) as client:
        response = client.post(
            route, content=(FIXTURES / request_file).read_bytes(), headers={"content-type": "application/json"}
        )
        assert response.status_code == status
        assert response.json() == expected


def test_social_fixture_text_only(client_factory, completion):
    request = fixture("request.social.json")
    with client_factory(lambda _: httpx.Response(200, json=completion({"text": "РџСЂРёРІРµС‚!"}))) as client:
        response = client.post("/v1/events", json=request)
        assert response.status_code == 200
        assert response.json() == {"requestId": request["requestId"], "text": "РџСЂРёРІРµС‚!"}


@pytest.mark.parametrize("request_name,route", [("request.game.json", "/v1/events"), ("request.chat.json", "/v1/chat")])
def test_v1_boundary_errors_and_exact_byte_cap(client_factory, completion, request_name, route):
    body = fixture(request_name)
    with client_factory(lambda _: pytest.fail("invalid input reached provider")) as client:
        for content, status in [(b"{", 400), (b"x" * 32769, 413)]:
            response = client.post(route, content=content, headers={"content-type": "application/json"})
            assert response.status_code == status
            assert response.json()["requestId"] is None
    raw = json.dumps(body).encode()
    raw += b" " * (32768 - len(raw))
    with client_factory(
        lambda _: httpx.Response(
            200,
            json=completion(
                {
                    "text": "Привет!",
                    **(
                        {"appraisal": {"category": "neutral", "intensity": "low", "confidence": "clear"}}
                        if route == "/v1/chat"
                        else {}
                    ),
                }
            ),
        )
    ) as client:
        assert client.post(route, content=raw, headers={"content-type": "application/json"}).status_code == 200
        assert client.post(route, content=raw + b" ", headers={"content-type": "application/json"}).status_code == 413


def test_event_prompt_output_cap_and_authoritative_outcome(client_factory, completion):
    body = fixture("request.game.json")
    body["event"]["outcome"] = "missed"
    calls = []

    def upstream(request):
        calls.append(request)
        data = json.loads(request.content)
        assert data["max_completion_tokens"] == 1024
        assert 0 < request.extensions["timeout"]["read"] <= 2.5
        messages = data["messages"]
        assert sum(item["role"] != "system" for item in messages) == 3  # character, memory, actual event
        assert "not spoken by the user" in messages[0]["content"]
        assert "outcome is authoritative factual context" in messages[0]["content"]
        assert "Desktop alone owns behavior" not in messages[0]["content"]
        assert "screen observations" in messages[0]["content"]
        memory = next(item["content"] for item in messages if item["content"].startswith("[Known facts about User]"))
        assert '.outcome: "caught"' in memory  # older recalled episode
        assert '"outcome": "missed"' in messages[-1]["content"]  # current authoritative event
        assert body["requestId"] not in request.content.decode()
        return httpx.Response(200, json=completion({"text": "РќР° СЌС‚РѕС‚ СЂР°Р· РїСЂРѕРјР°С…РЅСѓР»Р°СЃСЊ."}))

    with client_factory(upstream) as client:
        assert client.post("/v1/events", json=body).status_code == 200
    assert len(calls) == 1


def test_chat_bridge_preserves_ai_provenance_and_only_current_user_evidence(client_factory, chat_completion):
    body = fixture("request.chat.json")
    calls = []

    def upstream(request):
        calls.append(request)
        data = json.loads(request.content)
        assert data["max_completion_tokens"] == 4096
        assert 2.5 < request.extensions["timeout"]["read"] <= 10
        messages = data["messages"]
        assert messages[-1] == body["messages"][-1]
        previous = messages[-2]
        assert previous["content"].startswith(
            "Previous published AI initiative (not user speech or proof of attention):"
        )
        assert body["previousInitiative"]["text"] in previous["content"]
        assert "never evidence for a memory candidate" in messages[0]["content"]
        return httpx.Response(
            200,
            json=chat_completion(
                {
                    "text": "РҐРѕСЂРѕС€Рѕ.",
                    "memoryCandidates": [
                        {
                            "key": "user.favorite_topic",
                            "value": "РјСѓР·С‹РєР°",
                            "evidenceQuote": body["previousInitiative"]["text"],
                        },
                        {"key": "user.reply_style", "value": "brief", "evidenceQuote": body["messages"][-1]["content"]},
                    ],
                }
            ),
        )

    with client_factory(upstream) as client:
        response = client.post("/v1/chat", json=body)
        assert response.status_code == 200
        # Structural/source validation only; desktop recognizer still owns acceptance.
        assert [candidate["key"] for candidate in response.json()["memoryCandidates"]] == ["user.reply_style"]
    assert len(calls) == 1


def test_event_and_initiative_content_never_persist_or_log(app_factory, chat_completion, caplog):
    from fastapi.testclient import TestClient

    marker = "SYNTHETIC_V3_PRIVATE_TEXT_MARKER"
    body = fixture("request.chat.json")
    body["previousInitiative"]["text"] = marker
    app = app_factory(lambda _: httpx.Response(200, json=chat_completion({"text": marker})))
    with TestClient(app) as client:
        assert client.post("/v1/chat", json=body).status_code == 200
        path = app.state.completion_service.ledger.path
    for candidate in path.parent.glob(path.name + "*"):
        content = candidate.read_bytes()
        assert marker.encode() not in content
        assert b"social_bid_started" not in content
    assert marker not in caplog.text


@pytest.mark.parametrize("path,request_file", [("/v1/events", "request.game.json"), ("/v1/chat", "request.chat.json")])
@pytest.mark.parametrize(
    "failure,expected",
    [
        (httpx.ConnectError("private provider diagnostic"), 503),
        (httpx.ReadTimeout("private provider diagnostic"), 504),
        (httpx.Response(200, content=b"{invalid-provider-json"), 502),
    ],
)
def test_v1_transport_errors_keep_safe_error_envelope(client_factory, path, request_file, failure, expected):
    calls = []

    def upstream(request):
        calls.append(request)
        if isinstance(failure, Exception):
            raise failure
        return failure

    with client_factory(upstream) as client:
        response = client.post(path, json=fixture(request_file))
        assert response.status_code == expected
        assert "private" not in response.text
        assert len(calls) == 1
