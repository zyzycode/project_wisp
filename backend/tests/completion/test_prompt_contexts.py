"""Scenario isolation and preservation of validated wire input during dispatch."""

import json

import pytest
from tests.helpers import CONTRACT_FIXTURES
from wisp_backend.api.dispatch import prepare_context, prepare_job
from wisp_backend.api.endpoints import ENDPOINTS
from wisp_backend.completion.policies import POLICIES
from wisp_backend.completion.prompts.context import (
    DialogueTurn,
    InteractionChatContext,
    InteractionContext,
    ObservationContext,
    SummaryContext,
)

REQUEST_FIXTURES = {
    "/v1/chat": "desktop-backend-v1/interaction/request.chat.json",
    "/v1/touch": "desktop-backend-v1/interaction/request.touch.json",
    "/v1/events": "desktop-backend-v1/events/request.game.json",
    "/v1/summary": "desktop-backend-v1/summary/request.summary.json",
    "/v1/observation": "desktop-backend-v1/observation/request.valid.json",
}


@pytest.mark.parametrize("path", REQUEST_FIXTURES)
def test_dispatch_builds_only_the_selected_scenario_context(path: str) -> None:
    endpoint = ENDPOINTS[path]
    body = endpoint.request_type.model_validate(json.loads((CONTRACT_FIXTURES / REQUEST_FIXTURES[path]).read_bytes()))
    context = prepare_context(body)
    assert type(context) is POLICIES[endpoint.scenario].context_type
    assert POLICIES[endpoint.scenario].build_blocks(context) == prepare_job(body).inference.blocks
    for scenario, policy in POLICIES.items():
        if scenario != endpoint.scenario:
            with pytest.raises(TypeError, match="does not match"):
                policy.build_blocks(context)


def test_observation_and_summary_cannot_receive_chat_payloads() -> None:
    with pytest.raises(TypeError):
        ObservationContext(
            "ru",
            {},
            "Editor",
            "Title",
            memory={},
        )
    with pytest.raises(TypeError):
        SummaryContext("ru", (), character={})


def test_chat_requires_memory_and_interaction_policy() -> None:
    messages = (DialogueTurn("user", "Hello"),)
    with pytest.raises(TypeError):
        InteractionChatContext(
            "en",
            {},
            messages=messages,
            interaction=InteractionContext({}, "suppressed"),
        )
    with pytest.raises(TypeError):
        InteractionChatContext(
            "en",
            {},
            messages=messages,
            memory={},
        )
    assert (
        InteractionChatContext(
            "en",
            {},
            messages=messages,
            memory={},
            interaction=InteractionContext({}, "suppressed"),
        ).memory
        == {}
    )


@pytest.mark.parametrize(
    "messages",
    [
        (),
        (DialogueTurn("assistant", "Hi"),),
        (DialogueTurn("user", "Hi"), DialogueTurn("assistant", "Hi")),
        (DialogueTurn("user", "Hi"),) * 3,
    ],
)
def test_internal_chat_requires_alternating_pairs_and_current_user(messages: tuple[DialogueTurn, ...]) -> None:
    with pytest.raises(ValueError):
        InteractionChatContext(
            "en",
            {},
            messages=messages,
            memory={},
            interaction=InteractionContext({}, "suppressed"),
        )
