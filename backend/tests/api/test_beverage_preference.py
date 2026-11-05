"""Removed preference-specific fields cannot re-enable the retired coffee/tea flow."""

import json
from collections.abc import Callable

import pytest
from pydantic import ValidationError
from tests.api.test_interaction_validation import fixture
from wisp_backend.api.dispatch import prepare_job
from wisp_backend.api.schemas.interaction import InteractionChatRequest, InteractionChatResponse
from wisp_backend.completion.interaction_replies import InteractionChatReply
from wisp_backend.errors import ServiceError


@pytest.mark.parametrize(
    "value",
    [None, {"allowProposal": True}, {"allowProposal": False, "current": {"value": "coffee", "validity": "confirmed"}}],
)
def test_removed_request_field_is_rejected_before_provider(value: object, client_factory: Callable) -> None:
    body = {**fixture("request.chat.json"), "beveragePreference": value}
    with pytest.raises(ValidationError):
        InteractionChatRequest.model_validate(body)
    with client_factory(lambda _: pytest.fail("Removed field reached provider")) as client:
        response = client.post("/v1/chat", json=body)
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "invalid_request"


def test_removed_proposal_is_not_a_model_or_wire_reply_field() -> None:
    reply = {"text": "Hello", "appraisal": {"category": "neutral", "intensity": "low", "confidence": "clear"}}
    unexpected = {**reply, "beverageProposal": {"value": "tea", "evidenceQuote": "Hello"}}
    for model, value in (
        (InteractionChatReply, unexpected),
        (InteractionChatResponse, {"requestId": "removed-proposal", **unexpected}),
    ):
        with pytest.raises(ValidationError):
            model.model_validate(value)
    job = prepare_job(InteractionChatRequest.model_validate(fixture("request.chat.json")))
    with pytest.raises(ServiceError, match="invalid_model_response"):
        job.encoder.success(json.dumps(unexpected))
    response = json.loads(job.encoder.success(json.dumps(reply)).body)
    assert response["text"] == "Hello" and "beverageProposal" not in response
    assert all("beverage" not in block.key for block in job.inference.blocks)
