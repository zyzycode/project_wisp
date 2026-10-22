"""Strict text-only touch contracts, independent of chat hint sanitization."""

from typing import Annotated, Literal

from pydantic import BeforeValidator
from wisp_backend.api.schemas.common import CharacterContext, RequestId, false_only
from wisp_backend.validation import Contract


class TouchEvent(Contract):
    type: Literal["user_touch"]
    variant: Literal["touch"]


class TouchFields(Contract):
    requestId: RequestId
    event: TouchEvent
    stream: Annotated[Literal[False], BeforeValidator(false_only)]
    locale: Literal["ru", "en"]
    character: CharacterContext
