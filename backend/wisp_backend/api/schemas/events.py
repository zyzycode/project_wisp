"""Explicit v1 events and follow-up chat schemas, independent of local runtime."""

from typing import Annotated, Literal

from pydantic import BeforeValidator, Field, model_validator
from wisp_backend.api.schemas.common import CharacterContext, RequestId, false_only
from wisp_backend.api.schemas.memory import MemoryContext, Timestamp
from wisp_backend.api.schemas.window_help import PreviousWindowHelpInitiative, WindowHelpEvent
from wisp_backend.completion.replies import EventModelReply
from wisp_backend.validation import Contract, text_type


class CursorGameCompleted(Contract):
    type: Literal["cursor_game_completed"]
    outcome: Literal["caught", "missed", "lost_target"]
    executedMs: Annotated[float, Field(ge=0, le=60_000)]
    occurredAt: Timestamp


class SocialBidStarted(Contract):
    type: Literal["social_bid_started"]
    occurredAt: Timestamp


class EventRequest(Contract):
    requestId: RequestId
    event: Annotated[CursorGameCompleted | SocialBidStarted | WindowHelpEvent, Field(discriminator="type")]
    stream: Annotated[Literal[False], BeforeValidator(false_only)]
    locale: Literal["ru", "en"]
    character: CharacterContext
    memory: MemoryContext

    @model_validator(mode="after")
    def no_causal_window_help(self) -> "EventRequest":
        if self.event.type == "window_help_requested" and self.character.expression.causal is not None:
            raise ValueError("Window help does not accept causal expression")
        return self


class EventResponse(EventModelReply):
    requestId: RequestId


class OrdinaryPreviousInitiative(Contract):
    kind: Literal["cursor_game", "social_bid"]
    text: text_type(240)
    createdAt: Timestamp


PreviousInitiative = Annotated[OrdinaryPreviousInitiative | PreviousWindowHelpInitiative, Field(discriminator="kind")]
