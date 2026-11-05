"""Bounded desktop decision; no source identities or permission to mutate state."""

import json
from typing import Literal

from pydantic import StrictBool, model_validator
from wisp_backend.validation import Contract


class CausalExpression(Contract):
    intent: Literal["respond", "acknowledge", "give_space", "continue_activity"]
    emotion: Literal["content", "curious", "irritated"]
    intensity: Literal["low", "moderate"]
    target: Literal["user", "environment", "self"]
    cause: Literal["contact", "completed", "user_interrupted", "environment_lost", "timeout"]
    deferredInvitation: StrictBool
    ownGameInterest: Literal["none", "emerging", "established"]

    @model_validator(mode="after")
    def bounded(self) -> "CausalExpression":
        if len(json.dumps(self.model_dump(), ensure_ascii=False, separators=(",", ":")).encode("utf-8")) > 512:
            raise ValueError("Causal expression exceeds byte limit")
        return self
