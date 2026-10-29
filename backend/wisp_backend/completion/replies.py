"""Semantic AI replies; no HTTP envelopes or provider-specific payloads."""

from collections import Counter
from typing import Annotated, Literal, TypeAlias

from pydantic import Field, TypeAdapter, ValidationError, ValidationInfo, field_validator, model_validator
from wisp_backend.validation import Contract, omittable, text_type, trim_text

Unit = Annotated[float, Field(strict=True, ge=0, le=1, allow_inf_nan=False)]
Behavior = Literal[
    "respond", "think", "react_happy", "react_confused", "play", "sleep", "wake", "wander", "idle", "quiet"
]
Tone = Literal["warm", "playful", "sleepy", "curious", "confused", "quiet", "shy", "affectionate"]
Mood = Literal["neutral", "happy", "playful", "sleepy", "confused", "shy", "affectionate"]


class Decision(Contract):
    behavior: Behavior
    tone: Tone = omittable()
    mood: Mood = omittable()
    confidence: Unit


class ModelReply(Contract):
    """Only this content may be proposed by a provider, never the wire envelope."""

    text: text_type(2000)
    decision: Decision = omittable()

    @model_validator(mode="before")
    @classmethod
    def discard_invalid_hint(cls, value: object) -> object:
        if isinstance(value, dict) and "decision" in value:
            try:
                Decision.model_validate(value["decision"])
            except ValidationError:
                value = {key: item for key, item in value.items() if key != "decision"}
        return value

    @field_validator("text")
    @classmethod
    def trim_text(cls, value: str) -> str:
        return trim_text(value)


FactKey = Literal[
    "user.display_name", "user.preferred_address", "user.favorite_topic", "user.reply_style", "user.cursor_game"
]

FACT_VALUE_TYPES = {
    "user.display_name": TypeAdapter(text_type(80)),
    "user.preferred_address": TypeAdapter(text_type(80)),
    "user.favorite_topic": TypeAdapter(text_type(120)),
    "user.reply_style": TypeAdapter(Literal["brief", "detailed"]),
    "user.cursor_game": TypeAdapter(Literal["like", "dislike"]),
}
MEMORY_CANDIDATE_LIMIT = 3


def _fact_value_schema(schema: dict[str, object]) -> None:
    schema["x-wisp-values-by-key"] = {key: adapter.json_schema() for key, adapter in FACT_VALUE_TYPES.items()}


class MemoryFact(Contract):
    key: FactKey
    value: str = Field(json_schema_extra=_fact_value_schema)

    @model_validator(mode="after")
    def registry_value(self) -> "MemoryFact":
        FACT_VALUE_TYPES[self.key].validate_python(self.value)
        return self


class MemoryCandidate(MemoryFact):
    evidenceQuote: text_type(240)


class MemoryModelReply(ModelReply):
    memoryCandidates: Annotated[list[MemoryCandidate], Field(max_length=MEMORY_CANDIDATE_LIMIT)] = omittable()

    @model_validator(mode="before")
    @classmethod
    def discard_invalid_candidates(cls, value: object, info: ValidationInfo) -> object:
        if not isinstance(value, dict) or "memoryCandidates" not in value:
            return value
        candidates = value["memoryCandidates"]
        clean = {key: item for key, item in value.items() if key != "memoryCandidates"}
        if not isinstance(candidates, list) or len(candidates) > MEMORY_CANDIDATE_LIMIT:
            return clean
        counts = Counter(
            item.get("key") for item in candidates if isinstance(item, dict) and isinstance(item.get("key"), str)
        )
        quote = info.context.get("evidence_quote") if isinstance(info.context, dict) else None
        accepted = []
        for item in candidates:
            try:
                candidate = MemoryCandidate.model_validate(item)
                if counts[candidate.key] == 1 and candidate.evidenceQuote == quote:
                    accepted.append(candidate.model_dump())
            except ValidationError:
                pass
        return {**clean, "memoryCandidates": accepted}


class BeverageProposal(Contract):
    value: Literal["coffee", "tea"]
    evidenceQuote: text_type(240)

    @field_validator("evidenceQuote")
    @classmethod
    def already_trimmed(cls, value: str) -> str:
        if value != trim_text(value):
            raise ValueError("Quote must be trimmed")
        return value


class TouchModelReply(Contract):
    text: text_type(240)

    @field_validator("text")
    @classmethod
    def normalize_text(cls, value: str) -> str:
        return trim_text(value)


class EventModelReply(Contract):
    # Unlike chat hints, any additional event output field is a fatal model error.
    text: text_type(240)

    @field_validator("text")
    @classmethod
    def trim_reply(cls, value: str) -> str:
        return trim_text(value)


class SummaryModelReply(Contract):
    text: text_type(1200)


CompletionReply: TypeAlias = SummaryModelReply | ModelReply | MemoryModelReply | TouchModelReply | EventModelReply
