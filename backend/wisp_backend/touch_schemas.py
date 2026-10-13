"""Strict text-only touch contracts, independent of chat hint sanitization."""
from typing import Annotated, Literal

from pydantic import BeforeValidator, field_validator

from wisp_backend.schemas import (
    CharacterContext, Contract, RequestId, Version, false_only, text_type, trim_text,
)


class TouchEvent(Contract):
    type: Literal["user_touch"]
    variant: Literal["stroke", "touch", "ruffle", "poke"]


class TouchRequest(Contract):
    version: Version
    requestId: RequestId
    event: TouchEvent
    stream: Annotated[Literal[False], BeforeValidator(false_only)]
    locale: Literal["ru", "en"]
    character: CharacterContext


class TouchModelReply(Contract):
    text: text_type(240)

    @field_validator("text")
    @classmethod
    def normalize_text(cls, value: str) -> str:
        return trim_text(value)


class TouchResponse(TouchModelReply):
    version: Version
    requestId: RequestId
