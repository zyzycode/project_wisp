"""Target #183 declarations; decorative activity does not access book content."""

import json
from typing import Annotated, Literal

from pydantic import Field, StrictBool, model_validator
from wisp_backend.api.schemas.memory_timestamp import Timestamp
from wisp_backend.validation import Contract


class BookCompatibleCausalExpression(Contract):
    activity: Literal["contact", "cursor_game", "book"]
    intent: Literal["respond", "acknowledge", "give_space", "continue_activity"]
    emotion: Literal["content", "curious", "irritated"]
    intensity: Literal["low", "moderate"]
    target: Literal["user", "environment", "self"]
    cause: Literal["contact", "completed", "user_interrupted", "environment_lost", "timeout"]
    deferredInvitation: StrictBool
    ownActivityInterest: Literal["none", "emerging", "established"]

    @model_validator(mode="after")
    def coherent_activity(self) -> "BookCompatibleCausalExpression":
        if (self.activity == "contact") != (self.cause == "contact"):
            raise ValueError("Incoherent contact activity")
        if self.activity == "contact" and (self.ownActivityInterest != "none" or self.deferredInvitation):
            raise ValueError("Contact is not an activity-interest track")
        if self.activity == "book":
            target = (
                "self" if self.cause == "completed" else "user" if self.cause == "user_interrupted" else "environment"
            )
            emotion = "content" if self.cause == "completed" else "irritated"
            if self.deferredInvitation or self.intensity != "low" or self.target != target or self.emotion != emotion:
                raise ValueError("Incoherent decorative book expression")
        if len(json.dumps(self.model_dump(), ensure_ascii=False, separators=(",", ":")).encode("utf-8")) > 512:
            raise ValueError("Causal expression exceeds byte limit")
        return self


class BookHistoryEvent(Contract):
    activity: Literal["book"]
    outcome: Literal["completed", "cancelled", "failed"]
    cause: Literal["completed", "user_interrupted", "environment_lost", "timeout"]
    actor: Literal["user", "system", "autonomy", "unknown"]
    participation: Literal["solitary"]
    executedMs: Annotated[float, Field(strict=True, ge=0, le=600000, allow_inf_nan=False)]
    occurredAt: Timestamp

    @model_validator(mode="after")
    def coherent_terminal(self) -> "BookHistoryEvent":
        if (self.outcome == "completed") != (self.cause == "completed"):
            raise ValueError("Incoherent book completion")
        actor = "autonomy" if self.cause == "completed" else "user" if self.cause == "user_interrupted" else "system"
        if self.actor != actor or (self.outcome == "completed" and self.executedMs < 14000):
            raise ValueError("Incoherent book execution")
        return self


class BookMemoryEpisode(BookHistoryEvent):
    kind: Literal["causal_event"]
