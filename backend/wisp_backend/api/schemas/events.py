"""Explicit v3 events and follow-up chat schemas, independent of local runtime."""

from typing import Annotated, Literal

from pydantic import BeforeValidator, Field
from wisp_backend.api.schemas.common import CharacterContext, ErrorResponse, RequestId, false_only
from wisp_backend.api.schemas.memory import MemoryContext, MemoryRequest, MemoryResponse, Timestamp
from wisp_backend.completion.replies import EventModelReply
from wisp_backend.validation import Contract, omittable, text_type


def version_three(value: object) -> int:
    if type(value) is not int or value != 3:
        raise ValueError("Expected integer version 3")
    return value


VersionThree = Annotated[Literal[3], BeforeValidator(version_three)]


class CursorGameCompleted(Contract):
    type: Literal["cursor_game_completed"]
    outcome: Literal["caught", "missed", "lost_target"]
    executedMs: Annotated[float, Field(ge=0, le=60_000)]
    occurredAt: Timestamp


class SocialBidStarted(Contract):
    type: Literal["social_bid_started"]
    occurredAt: Timestamp


class EventRequest(Contract):
    version: VersionThree
    requestId: RequestId
    event: Annotated[CursorGameCompleted | SocialBidStarted, Field(discriminator="type")]
    stream: Annotated[Literal[False], BeforeValidator(false_only)]
    locale: Literal["ru", "en"]
    character: CharacterContext
    memory: MemoryContext


class EventResponse(EventModelReply):
    version: VersionThree
    requestId: RequestId


class PreviousInitiative(Contract):
    kind: Literal["cursor_game", "social_bid"]
    text: text_type(240)
    createdAt: Timestamp


class EventAwareChatRequest(MemoryRequest):
    version: VersionThree
    previousInitiative: PreviousInitiative = omittable()


class EventAwareChatResponse(MemoryResponse):
    version: VersionThree


class EventErrorResponse(ErrorResponse):
    version: VersionThree
