"""HTTP envelope primitives and desktop context input models."""

import re
from typing import Annotated, Literal

from pydantic import Field, StrictBool, model_validator
from wisp_backend.errors import ErrorCode
from wisp_backend.validation import Contract, omittable, text_type, validate_text


def false_only(value: object) -> Literal[False]:
    if value is not False:
        raise ValueError("Only stream=false is supported")
    return value


UUID4_PATTERN = r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"
RequestId = Annotated[str, Field(pattern=UUID4_PATTERN)]
Percent = Annotated[float, Field(strict=True, ge=0, le=100, allow_inf_nan=False)]
Unit = Annotated[float, Field(strict=True, ge=0, le=1, allow_inf_nan=False)]
Bond = Annotated[float, Field(strict=True, ge=0, le=1000, allow_inf_nan=False)]
CharacterTone = Literal["shy", "sleepy", "playful", "curious", "neutral", "affectionate", "flustered"]


def read_request_id(value: object) -> str | None:
    if isinstance(value, dict):
        candidate = value.get("requestId")
        if isinstance(candidate, str) and re.fullmatch(UUID4_PATTERN, candidate):
            return candidate
    return None


class HealthResponse(Contract):
    status: Literal["ok"] = "ok"


class Message(Contract):
    role: Literal["user", "assistant"]
    content: str

    @model_validator(mode="after")
    def content_length(self) -> "Message":
        validate_text(self.content, 240 if self.role == "user" else 2000)
        return self


class Needs(Contract):
    energy: Percent
    attention: Percent
    play: Percent
    comfort: Percent
    boredom: Percent = omittable()


class Relationship(Contract):
    friendship: Bond
    love: Bond
    loveUnlocked: StrictBool


class Traits(Contract):
    shyness: Unit
    playfulness: Unit
    sensitivity: Unit
    boldness: Unit


class Personality(Contract):
    presetId: text_type(128)
    aiSelfConcept: text_type(500)
    traits: Traits


class Intimacy(Contract):
    flirtiness: Percent
    romanticCharge: Percent
    userConsentEnabled: StrictBool


class Expression(Contract):
    pace: Literal["gentle", "normal"]
    trust: Literal["guarded", "familiar", "close"]
    attention: Literal["high", "ordinary"]
    play: Literal["high", "ordinary"]
    romanceAllowed: StrictBool


class CharacterContext(Contract):
    needs: Needs
    relationship: Relationship
    personality: Personality
    intimacy: Intimacy
    synthesizedTone: CharacterTone
    expression: Expression


class Event(Contract):
    type: Literal["user_message"]


class ErrorDetail(Contract):
    code: ErrorCode
    retryAfterMs: Annotated[int, Field(ge=1, le=86_400_000)] = omittable()


class ErrorResponse(Contract):
    requestId: RequestId | None
    error: ErrorDetail
