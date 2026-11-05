"""Strict source-validated causal facts, without local identities or inferred feelings."""

from typing import Annotated, Literal

from pydantic import Field, model_validator
from wisp_backend.api.schemas.memory_timestamp import Timestamp
from wisp_backend.validation import Contract


class CausalMemoryEpisode(Contract):
    kind: Literal["causal_event"]
    activity: Literal["cursor_game", "contact"]
    outcome: Literal["completed", "cancelled", "failed", "not_applicable"]
    cause: Literal["contact", "completed", "user_interrupted", "environment_lost", "timeout"]
    actor: Literal["user", "system", "autonomy", "unknown"]
    participation: Literal["user_engaged", "solitary", "none"]
    executedMs: Annotated[float, Field(ge=0, le=600_000)]
    occurredAt: Timestamp

    @model_validator(mode="after")
    def coherent_event(self) -> "CausalMemoryEpisode":
        if self.activity == "contact":
            if (self.outcome, self.cause, self.actor, self.participation, self.executedMs) != (
                "not_applicable",
                "contact",
                "user",
                "none",
                0,
            ):
                raise ValueError("Invalid contact event")
        elif (
            self.outcome == "not_applicable"
            or self.cause == "contact"
            or (self.outcome == "completed") != (self.cause == "completed")
            or (self.cause == "user_interrupted" and self.actor != "user")
        ):
            raise ValueError("Invalid activity event")
        return self
