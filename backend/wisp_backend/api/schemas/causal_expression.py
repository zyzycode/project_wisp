"""Bounded activity-aware desktop expression; no source identities or state writes."""

import json
from typing import Literal

from pydantic import StrictBool, model_validator
from wisp_backend.validation import Contract


class CausalExpression(Contract):
    activity: Literal["contact", "cursor_game", "book"]
    intent: Literal["respond", "acknowledge", "give_space", "continue_activity"]
    emotion: Literal["content", "curious", "irritated"]
    intensity: Literal["low", "moderate"]
    target: Literal["user", "environment", "self"]
    cause: Literal["contact", "completed", "user_interrupted", "environment_lost", "timeout"]
    deferredInvitation: StrictBool
    ownActivityInterest: Literal["none", "emerging", "established"]

    @model_validator(mode="after")
    def coherent_activity(self) -> "CausalExpression":
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
