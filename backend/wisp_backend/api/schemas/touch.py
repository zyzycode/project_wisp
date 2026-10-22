"""Strict text-only touch contracts, independent of chat hint sanitization."""

from typing import Annotated, Literal

from pydantic import BeforeValidator
from wisp_backend.api.schemas.common import CharacterContext, RequestId, Version, false_only
from wisp_backend.completion.replies import TouchModelReply
from wisp_backend.validation import Contract


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


class TouchResponse(TouchModelReply):
    version: Version
    requestId: RequestId
