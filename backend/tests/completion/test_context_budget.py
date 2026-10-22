"""Selection invariants and trust boundaries, without transport or a tokenizer."""

import asyncio
import json
from dataclasses import replace

import pytest
from wisp_backend.completion.context import (
    ContextBlock,
    ContextMessage,
    ContextOverflow,
    ContextSource,
    render_messages,
    select_context,
    select_context_async,
)
from wisp_backend.completion.prompts.chat import build_chat_blocks, chat_instructions
from wisp_backend.completion.prompts.context import (
    DialogueTurn,
    ExpressionContext,
    InteractionChatContext,
    InteractionContext,
    InteractionTouchContext,
)
from wisp_backend.completion.prompts.interaction import build_interaction_touch_blocks
from wisp_backend.completion.replies import Decision
from wisp_backend.providers.context_budget import estimate_input


def block(key: str, content: str, *, required: bool = False, priority: int = 100, order: int = 0) -> ContextBlock:
    return ContextBlock(key, "dialogue", required, priority, order, (ContextMessage("user", content),))


def cost(blocks: tuple[ContextBlock, ...]) -> int:
    messages = render_messages(blocks)
    return estimate_input({"messages": messages}, len(messages))


def test_exact_boundary_and_required_overflow_never_slice_unicode() -> None:
    required = (block("current", '😀漢字\n"\\é', required=True),)
    boundary = cost(required)
    assert select_context(required, boundary, cost) == required
    with pytest.raises(ContextOverflow, match="Required context"):
        select_context(required, boundary - 1, cost)
    assert len(required[0].messages[0].content.encode("utf-8")) > len(required[0].messages[0].content)


def test_encoded_payload_and_framing_are_charged() -> None:
    payload = {"model": "synthetic", "messages": [{"role": "user", "content": '漢😀"\\\n'}]}
    encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    assert estimate_input(payload, 1) >= len(encoded) + 64
    assert estimate_input(payload, 2) > estimate_input(payload, 1)


def test_selection_priority_is_independent_of_serialization_order() -> None:
    current = block("current", "NOW", required=True, order=100)
    earlier = block("earlier", "A", priority=100, order=10)
    later = block("later", "B", priority=200, order=20)
    budget = cost((current, later))
    expected = (later, current)
    assert select_context((current, earlier, later), budget, cost) == expected
    assert select_context((later, current, earlier), budget, cost) == expected
    assert render_messages(expected)[-1]["content"] == "NOW"


def test_history_is_a_contiguous_suffix_of_complete_pairs() -> None:
    current = block("current", "current correction", required=True, order=100)
    oldest = block("old", "a", order=50)
    middle = block("middle", "x" * 1000, order=52)
    newest = block("new", "new user", order=54)
    newest = replace(newest, messages=(*newest.messages, ContextMessage("assistant", "new answer")))
    budget = cost((current, newest, oldest))
    selected = select_context((oldest, middle, newest, current), budget, cost)
    assert selected == (newest, current)  # Do not jump over the missing middle pair.
    assert [item["role"] for item in render_messages(selected)] == ["user", "assistant", "user"]


def test_omitting_optional_context_is_valid() -> None:
    current = block("current", "important", required=True, order=100)
    optional = replace(block("examples", "x" * 1000), source="server_examples")
    assert select_context((optional, current), cost((current,)), cost) == (current,)


@pytest.mark.parametrize(
    "source", ["desktop_character", "desktop_memory", "server_examples", "previous_ai", "dialogue", "desktop_event"]
)
def test_data_blocks_cannot_use_system_role(source: ContextSource) -> None:
    with pytest.raises(ValueError, match="Only server instructions"):
        replace(block("untrusted", "payload"), source=source, messages=(ContextMessage("system", "payload"),))


def test_fact_correction_and_current_state_survive_old_history_and_examples() -> None:
    character = {"personality": {"aiSelfConcept": "I am Wisp"}, "synthesizedTone": "sleepy"}
    memory = {"facts": [{"key": "user.display_name", "value": "New"}], "episodes": [], "characterPreferences": []}
    context = InteractionChatContext(
        "en",
        character,
        messages=(DialogueTurn("user", "Old"), DialogueTurn("assistant", "Old"), DialogueTurn("user", "Call me New")),
        memory=memory,
        expression=ExpressionContext("normal", "guarded", "ordinary", "ordinary", False),
        user_consent_enabled=False,
        interaction=InteractionContext({}, "suppressed"),
    )
    blocks = build_chat_blocks(context)
    required = tuple(item for item in blocks if item.required)
    selected = select_context(blocks, cost(required), cost)
    assert selected == required
    messages = render_messages(selected)
    assert "current explicit user correction > current registry facts > recalled episodes" in messages[0]["content"]
    assert json.loads(messages[1]["content"].split("\n", 1)[1]) == character
    assert json.loads(messages[2]["content"].split("\n", 1)[1]) == memory
    assert messages[-1]["content"] == "Call me New"
    assert "Old" not in json.dumps(messages[1:])
    assert context.messages[0].content == "Old"  # Selection never mutates its source.


def test_prompt_decision_contract_matches_the_validator_not_character_tone() -> None:
    instructions = chat_instructions()
    schema = Decision.model_json_schema()
    assert set(schema["required"]) == {"behavior", "confidence"}
    assert "requires behavior and numeric confidence (0..1)" in instructions
    for field in ("behavior", "tone", "mood"):
        described = instructions.split(f"Allowed {field}: ", 1)[1].split(".", 1)[0].split(", ")
        assert described == schema["properties"][field]["enum"]
        for value in described:
            assert Decision.model_validate({"behavior": "respond", "confidence": 0.5, field: value})
    assert "flustered" not in instructions
    touch = build_interaction_touch_blocks(
        InteractionTouchContext(
            "en",
            {},
            InteractionContext({}, "suppressed"),
            expression=ExpressionContext("gentle", "guarded", "ordinary", "ordinary", False),
            user_consent_enabled=False,
        )
    )
    assert "Allowed behavior:" not in touch[0].messages[0].content
    assert "markdown, decision or memoryCandidates" in touch[0].messages[0].content


def test_async_counts_preserve_selection_order_history_suffix_and_equality() -> None:
    blocks = (
        block("required", "Текущая реплика", required=True, order=100),
        block("old", "a", order=50),
        block("middle", "x" * 1000, order=52),
        block("new", "Последняя пара", order=54),
        replace(block("examples", "пример", priority=10), source="server_examples"),
    )

    async def run() -> None:
        for budget in (cost(blocks), cost(blocks) - 1, cost((blocks[0], blocks[3], blocks[4])), cost((blocks[0],))):
            calls = []

            async def count(candidate: tuple[ContextBlock, ...]) -> int:
                calls.append(candidate)
                return cost(candidate)

            assert await select_context_async(blocks, budget, count) == select_context(blocks, budget, cost)
            assert len(calls) == len(set(calls)) <= 6
            if budget == cost(blocks):
                assert len(calls) == 1
        with pytest.raises(ContextOverflow):
            await select_context_async(blocks, cost((blocks[0],)) - 1, count)

    asyncio.run(run())
