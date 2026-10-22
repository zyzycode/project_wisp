"""Semantic AI replies; no HTTP envelopes or provider-specific payloads."""

from collections import Counter
from typing import Annotated, Literal, TypeAlias

from pydantic import Field, ValidationError, ValidationInfo, field_validator, model_validator
from wisp_backend.validation import Contract, omittable, text_type, trim_text, validate_text

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


class MemoryFact(Contract):
    key: FactKey
    value: str

    @model_validator(mode="after")
    def registry_value(self) -> "MemoryFact":
        if self.key == "user.reply_style":
            if self.value not in ("brief", "detailed"):
                raise ValueError("Invalid reply style")
        elif self.key == "user.cursor_game":
            if self.value not in ("like", "dislike"):
                raise ValueError("Invalid cursor preference")
        else:
            validate_text(self.value, 120 if self.key == "user.favorite_topic" else 80)
        return self


class MemoryCandidate(MemoryFact):
    evidenceQuote: text_type(240)


class MemoryModelReply(ModelReply):
    memoryCandidates: list[MemoryCandidate] = omittable()

    @model_validator(mode="before")
    @classmethod
    def discard_invalid_candidates(cls, value: object, info: ValidationInfo) -> object:
        if not isinstance(value, dict) or "memoryCandidates" not in value:
            return value
        candidates = value["memoryCandidates"]
        clean = {key: item for key, item in value.items() if key != "memoryCandidates"}
        if not isinstance(candidates, list) or len(candidates) > 3:
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
