import json

import httpx
import pytest
from pydantic import ValidationError
from tests.helpers import CONTRACT_FIXTURES
from wisp_backend.api.schemas.events import EventRequest
from wisp_backend.api.schemas.interaction import InteractionChatRequest

FIXTURES = CONTRACT_FIXTURES / "desktop-backend-v1/window-help"


def fixture(name):
    return json.loads((FIXTURES / name).read_bytes())


def test_help_shared_fixture_strict_privacy_and_outcome():
    body = fixture("request.help.json")
    EventRequest.model_validate(body)
    for field, value in [("surfaceId", "opaque"), ("geometry", {}), ("targetRegion", "unknown")]:
        bad = {**body, "event": {**body["event"], field: value}}
        with pytest.raises(ValidationError):
            EventRequest.model_validate(bad)
    chat = fixture("request.chat.json")
    for outcome in ["waiting", "assisting", "fulfilled", "declined", "unanswered", "cancelled", "target_lost"]:
        chat["previousInitiative"]["outcome"] = outcome
        InteractionChatRequest.model_validate(chat)
    del chat["previousInitiative"]["outcome"]
    with pytest.raises(ValidationError):
        InteractionChatRequest.model_validate(chat)


def test_help_crosses_real_route_and_prompt_without_provider_actions(client_factory, completion):
    prompts = []

    def upstream(request):
        prompts.append(request.content.decode())
        return httpx.Response(200, json=completion({"text": "Поможешь мне перебраться на это окно?"}))

    with client_factory(upstream) as client:
        body = fixture("request.help.json")
        response = client.post("/v1/events", json=body)
        assert response.status_code == 200
        assert set(response.json()) == {"requestId", "text"}
    assert len(prompts) == 1
    assert "window_help_requested" in prompts[0]
    assert "text only, never an action or success signal" in prompts[0]
