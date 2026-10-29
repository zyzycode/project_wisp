"""Response descriptions follow validator types without relaxing semantic validation."""

import asyncio
import json
import re
from typing import Annotated, Literal, get_args

import httpx
import pytest
from pydantic import Field, ValidationError
from wisp_backend.completion.context import StructuredReplySchema
from wisp_backend.completion.interaction_replies import (
    SUPPRESSED_APPRAISAL,
    InteractionChatReply,
    InteractionTouchReply,
)
from wisp_backend.completion.prompts.response_format import compact_provider_schema, describe_field, describe_reply
from wisp_backend.completion.replies import (
    FACT_VALUE_TYPES,
    MEMORY_CANDIDATE_LIMIT,
    Decision,
    EventModelReply,
    FactKey,
    MemoryFact,
    SummaryModelReply,
)
from wisp_backend.config.settings import AssistantSettings
from wisp_backend.providers.context_budget import CONTEXT_WINDOWS
from wisp_backend.providers.gemini import GeminiProvider
from wisp_backend.providers.openai import OpenAIProvider
from wisp_backend.validation import Contract, omittable, text_type


class SyntheticReply(Contract):
    text: text_type(8)
    action: Literal["inspect", "rest"]
    strength: Annotated[float, Field(ge=0.2, le=0.8)]
    hint: Literal["soft", "firm"] = omittable()
    choices: Annotated[list[Literal["east", "west"]], Field(max_length=2)]


class ChangedSyntheticReply(SyntheticReply):
    text: text_type(12)
    action: Literal["hover", "land"]
    choices: Annotated[list[Literal["north", "south"]], Field(max_length=4)]


def test_new_model_literals_limits_and_optionality_reach_the_description() -> None:
    original = describe_reply(SyntheticReply)
    changed = describe_reply(ChangedSyntheticReply)
    assert 'text:text<=8,action:"inspect"|"rest"' in original
    assert 'text:text<=12,action:"hover"|"land"' in changed
    assert 'choices:["east"|"west"]<=2' in original
    assert 'choices:["north"|"south"]<=4' in changed
    assert "strength:number>=0.2<=0.8" in changed
    assert 'hint?:"soft"|"firm"' in changed
    assert "? means omittable, not null" in changed
    valid = {"text": "😀" * 6, "action": "hover", "strength": 0.5, "choices": ["north"]}
    assert "hint" not in ChangedSyntheticReply.model_validate(valid).model_fields_set
    for invalid in ({**valid, "hint": None}, {**valid, "text": valid["text"] + "a"}, {**valid, "action": "inspect"}):
        with pytest.raises(ValidationError):
            ChangedSyntheticReply.model_validate(invalid)


@pytest.mark.parametrize(
    "reply_type,limit",
    [(InteractionChatReply, 2000), (InteractionTouchReply, 240), (EventModelReply, 240), (SummaryModelReply, 1200)],
)
def test_utf16_description_and_original_length_validation_share_the_same_limit(reply_type, limit) -> None:
    assert f"text:text<={limit}" in describe_reply(reply_type)
    schema = reply_type.model_json_schema()["properties"]["text"]
    assert schema["x-wisp-utf16-max"] == limit and "maxLength" not in schema
    payload = {"text": "😀" * (limit // 2)}
    if "appraisal" in reply_type.model_fields:
        payload["appraisal"] = SUPPRESSED_APPRAISAL
    reply_type.model_validate(payload)
    for text in (payload["text"] + "a", " " + "a" * limit, "bad\r", "\ud800"):
        with pytest.raises(ValidationError):
            reply_type.model_validate({**payload, "text": text})


def test_optional_sanitation_and_required_null_rejection_are_unchanged() -> None:
    value = {"text": "Hello", "appraisal": SUPPRESSED_APPRAISAL}
    result = InteractionChatReply.model_validate(
        {**value, "decision": None, "memoryCandidates": None, "beverageProposal": None},
        context={"beverage_proposal_allowed": True, "evidence_quote": "Hello"},
    )
    assert result.model_dump(exclude_unset=True) == value
    with pytest.raises(ValidationError):
        Decision.model_validate({"behavior": "respond", "confidence": 0.5, "tone": None})
    for field in ("text", "appraisal"):
        with pytest.raises(ValidationError):
            InteractionChatReply.model_validate({**value, field: None})


def test_fact_value_metadata_drives_descriptions_and_candidate_sanitation() -> None:
    assert set(FACT_VALUE_TYPES) == set(get_args(FactKey))
    metadata = MemoryFact.model_json_schema()["properties"]["value"]["x-wisp-values-by-key"]
    assert metadata == {key: adapter.json_schema() for key, adapter in FACT_VALUE_TYPES.items()}
    description = describe_field(MemoryFact, "value")
    for key in FACT_VALUE_TYPES:
        assert key + ":" in description
    for key, valid, invalid in (
        ("user.display_name", "😀" * 40, "😀" * 40 + "a"),
        ("user.favorite_topic", "😀" * 60, "😀" * 60 + "a"),
        ("user.reply_style", "brief", "long"),
        ("user.cursor_game", "like", "love"),
    ):
        MemoryFact.model_validate({"key": key, "value": valid})
        with pytest.raises(ValidationError):
            MemoryFact.model_validate({"key": key, "value": invalid})
    quote = "My name is Wisp and I like astronomy"
    candidates = [
        {"key": "user.display_name", "value": "Wisp", "evidenceQuote": quote},
        {"key": "user.favorite_topic", "value": "astronomy", "evidenceQuote": quote},
        {"key": "user.reply_style", "value": "brief", "evidenceQuote": quote},
    ]
    assert len(candidates) == MEMORY_CANDIDATE_LIMIT
    schema = InteractionChatReply.model_json_schema()
    assert schema["properties"]["memoryCandidates"]["maxItems"] == MEMORY_CANDIDATE_LIMIT
    assert f"]<={MEMORY_CANDIDATE_LIMIT}" in describe_reply(InteractionChatReply)
    base = {"text": "Hello", "appraisal": SUPPRESSED_APPRAISAL, "memoryCandidates": candidates}
    accepted = InteractionChatReply.model_validate(base, context={"evidence_quote": quote})
    assert len(accepted.memoryCandidates) == MEMORY_CANDIDATE_LIMIT
    over = InteractionChatReply.model_validate(
        {**base, "memoryCandidates": candidates + [candidates[0]]}, context={"evidence_quote": quote}
    )
    assert "memoryCandidates" not in over.model_fields_set
    wrong_evidence = InteractionChatReply.model_validate(base, context={"evidence_quote": "Different user text"})
    assert wrong_evidence.memoryCandidates == []


def test_suppressed_shape_and_beverage_projection_do_not_broaden_the_reply() -> None:
    base = describe_reply(InteractionChatReply, exclude=("beverageProposal",))
    assert "beverageProposal" not in base
    enabled = describe_field(InteractionChatReply, "beverageProposal")
    assert 'beverageProposal?:{value:"coffee"|"tea",evidenceQuote:text<=240}' == enabled
    suppressed = describe_reply(InteractionChatReply, exclude=("beverageProposal",), suppressed=True)
    match = re.search(r"appraisal:(\{[^}]+\})", suppressed)
    assert match is not None and json.loads(match.group(1)) == SUPPRESSED_APPRAISAL
    for unavailable in ('"supportive"', '"hostile"', '"moderate"', "beverageProposal"):
        assert unavailable not in suppressed
    with pytest.raises(ValidationError):
        InteractionChatReply.model_validate(
            {"text": "Hello", "appraisal": {**SUPPRESSED_APPRAISAL, "category": "supportive"}},
            context={"effect_policy": "suppressed"},
        )


@pytest.mark.parametrize("provider,model", list(CONTEXT_WINDOWS))
def test_existing_provider_schema_modes_stay_non_strict_and_local_metadata_stays_local(provider, model) -> None:
    document = compact_provider_schema(InteractionChatReply)
    encoded = json.dumps(document)
    assert "x-wisp-" not in encoded and '"title"' not in encoded and '"description"' not in encoded
    assert document["required"] == ["appraisal", "text"]
    assert "beverageProposal" in document["properties"]
    schema = StructuredReplySchema("beverage_proposal", encoded)

    async def run():
        settings = AssistantSettings(provider=provider, model=model)
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _: pytest.fail("Unexpected HTTP"))) as client:
            adapter = (OpenAIProvider if provider == "openai" else GeminiProvider)(client, settings)
            messages = [{"role": "system", "content": describe_reply(InteractionChatReply)}]
            base = adapter.request(messages, settings, 4096)[1]
            enabled = adapter.request(messages, settings, 4096, response_schema=schema)[1]
            if provider == "openai":
                assert base["response_format"] == {"type": "json_object"}
                assert enabled["response_format"]["json_schema"]["strict"] is False
                assert enabled["response_format"]["json_schema"]["schema"] == document
            else:
                assert "responseJsonSchema" not in base["generationConfig"]
                assert enabled["generationConfig"]["responseJsonSchema"] == document

    asyncio.run(run())
