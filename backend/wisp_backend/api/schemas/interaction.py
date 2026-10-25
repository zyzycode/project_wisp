"""Canonical v1 chat and touch wire forms with semantic appraisal."""

from typing import Annotated, Literal

from pydantic import BeforeValidator, field_validator, model_validator
from wisp_backend.api.schemas.chat import ChatFields
from wisp_backend.api.schemas.common import RequestId
from wisp_backend.api.schemas.events import PreviousInitiative
from wisp_backend.api.schemas.memory import MemoryContext, Timestamp
from wisp_backend.api.schemas.touch import TouchEvent, TouchFields
from wisp_backend.completion.interaction_replies import InteractionChatReply, InteractionTouchReply, TouchAppraisal
from wisp_backend.completion.replies import SummaryModelReply
from wisp_backend.validation import Contract, omittable, text_type, trim_text


def revision_two(value: object) -> int:
    if type(value) is not int or value != 2:
        raise ValueError("Expected integer revision 2")
    return value


class CharacterCard(Contract):
    id: Literal["curiousStubbornGirl"]
    revision: Annotated[Literal[2], BeforeValidator(revision_two)]


class InteractionPolicy(Contract):
    card: CharacterCard
    effectPolicy: Literal["eligible", "suppressed"]


class ActualTouch(TouchEvent):
    variant: Literal["touch"]


class PreviousTouch(Contract):
    action: Literal["touch"]
    occurredAt: Timestamp
    publishedText: text_type(240)
    appraisal: TouchAppraisal
    effect: Literal["accepted", "neutral", "suppressed", "rejected"]
    reason: Literal["applied", "neutral", "uncertain", "cooldown", "state_changed", "unavailable"]
    energyBand: Literal["tired", "rested"]
    comfortBand: Literal["calm", "overloaded"]

    @field_validator("publishedText")
    @classmethod
    def already_trimmed(cls, value: str) -> str:
        if value != trim_text(value):
            raise ValueError("Published text must be trimmed")
        return value

    @model_validator(mode="after")
    def effect_reason(self) -> "PreviousTouch":
        pairs = {
            "accepted": ("applied",),
            "neutral": ("neutral", "uncertain"),
            "suppressed": ("cooldown",),
            "rejected": ("state_changed", "unavailable"),
        }
        if self.reason not in pairs[self.effect]:
            raise ValueError("Invalid effect/reason pair")
        return self


class InteractionTouchRequest(TouchFields, InteractionPolicy):
    event: ActualTouch

    @model_validator(mode="after")
    def card_matches(self) -> "InteractionTouchRequest":
        if self.card.id != self.character.personality.presetId:
            raise ValueError("Card does not match character")
        return self


class DialogueTopic(Contract):
    mode: Literal["follow_up", "reply"]
    text: text_type(160)
    statedAt: Timestamp

    @field_validator("text")
    @classmethod
    def already_trimmed(cls, value: str) -> str:
        if value != trim_text(value):
            raise ValueError("Topic text must be trimmed")
        return value


class InteractionChatRequest(ChatFields, InteractionPolicy):
    memory: MemoryContext
    previousInitiative: PreviousInitiative = omittable()
    summary: SummaryModelReply = omittable()
    previousTouch: PreviousTouch = omittable()
    dialogueTopic: DialogueTopic = omittable()

    @model_validator(mode="after")
    def card_matches(self) -> "InteractionChatRequest":
        if self.card.id != self.character.personality.presetId:
            raise ValueError("Card does not match character")
        return self


class InteractionTouchResponse(InteractionTouchReply):
    requestId: RequestId


class InteractionChatResponse(InteractionChatReply):
    requestId: RequestId
