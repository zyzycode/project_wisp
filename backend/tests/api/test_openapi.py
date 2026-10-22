import json

import httpx
import pytest


def test_public_schema(client_factory, body):
    with client_factory(lambda _: httpx.Response(200)) as client:
        spec = client.get("/openapi.json").json()
        assert set(spec["paths"]) == {
            "/health",
            "/v1/chat",
            "/v1/touch",
            "/v1/events",
            "/v1/summary",
            "/v1/observation",
        }
        assert "/v1/chat/completions" not in spec["paths"]
        assert "/v1/assistants" not in spec["paths"]
        operation = spec["paths"]["/v1/chat"]["post"]
        assert set(operation["responses"]) == {"200", "400", "409", "413", "429", "502", "503", "504"}
        touch = spec["paths"]["/v1/touch"]["post"]
        assert set(touch["responses"]) == set(operation["responses"])
        schemas = spec["components"]["schemas"]
        assert set(schemas["InteractionChatRequest"]["required"]) == {
            "version",
            "requestId",
            "event",
            "messages",
            "stream",
            "locale",
            "character",
            "memory",
            "card",
            "effectPolicy",
        }
        assert schemas["InteractionChatRequest"]["additionalProperties"] is False
        assert "default" not in schemas["Needs"]["properties"]["boredom"]
        assert set(schemas["InteractionChatResponse"]["properties"]) == {
            "version",
            "requestId",
            "text",
            "decision",
            "memoryCandidates",
            "appraisal",
        }
        assert set(schemas["InteractionTouchResponse"]["properties"]) == {"version", "requestId", "text", "appraisal"}
        assert "playful" in schemas["Decision"]["properties"]["mood"]["enum"]
        for private in ["groq", "gpt-oss", "quota", "text/event-stream"]:
            assert private not in json.dumps(spec).lower()
        assert client.get("/health").json() == {"status": "ok"}


@pytest.mark.parametrize(
    "path",
    ["/v2/chat", "/v3/chat", "/v3/events", "/v5/chat", "/v5/summary", "/v6/observation", "/v7/chat", "/v7/touch"],
)
def test_removed_routes_are_not_served(client_factory, body, path):
    with client_factory(lambda _: pytest.fail("Removed route must not call provider")) as client:
        assert client.post(path, json=body).status_code == 404


@pytest.mark.parametrize("version", [2, 3, 5, 6, 7])
@pytest.mark.parametrize("path", ["/v1/chat", "/v1/touch", "/v1/events", "/v1/summary", "/v1/observation"])
def test_only_current_envelope_is_accepted(client_factory, version, path):
    from tests.completion.test_prompt_contexts import REQUEST_FIXTURES
    from tests.helpers import CONTRACT_FIXTURES

    body = json.loads((CONTRACT_FIXTURES / REQUEST_FIXTURES[path]).read_bytes())
    body["version"] = version
    with client_factory(lambda _: pytest.fail("Invalid version must not call provider")) as client:
        response = client.post(path, json=body)
        assert response.status_code == 400
        assert response.json()["version"] == 1
        assert response.json()["error"]["code"] == "unsupported_version"
