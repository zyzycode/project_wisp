import json

import httpx


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
            "requestId",
            "text",
            "decision",
            "memoryCandidates",
            "beverageProposal",
            "appraisal",
        }
        assert set(schemas["InteractionTouchResponse"]["properties"]) == {"requestId", "text", "appraisal"}
        assert "playful" in schemas["Decision"]["properties"]["mood"]["enum"]
        for private in ["groq", "gpt-oss", "quota", "text/event-stream"]:
            assert private not in json.dumps(spec).lower()
        assert client.get("/health").json() == {"status": "ok"}
