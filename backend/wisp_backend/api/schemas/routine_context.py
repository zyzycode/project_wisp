"""WORLD-A01 target model; active request rollout belongs to #189."""

from datetime import date
from typing import Annotated, Literal

from pydantic import Field, field_validator, model_validator
from wisp_backend.validation import Contract


class RoutineHypothesis(Contract):
    scope: Literal["while_wisp_running"]
    validity: Literal["tentative"]
    windowStartHour: Literal[0, 6, 12, 18]
    eligibleDays: Annotated[int, Field(ge=14, le=28)]
    positiveDays: Annotated[int, Field(ge=0, le=28)]
    recentPositiveDays: Annotated[int, Field(ge=5, le=7)]
    observedThroughDate: Annotated[str, Field(min_length=10, max_length=10)]

    @field_validator("windowStartHour", mode="before")
    @classmethod
    def strict_window(cls, value: object) -> object:
        if not isinstance(value, int) or isinstance(value, bool):
            raise ValueError("Expected integer window")
        return value

    @field_validator("observedThroughDate")
    @classmethod
    def calendar_date(cls, value: str) -> str:
        if date.fromisoformat(value).isoformat() != value:
            raise ValueError("Invalid local date")
        return value

    @model_validator(mode="after")
    def sufficient_evidence(self) -> "RoutineHypothesis":
        if (
            self.positiveDays > self.eligibleDays
            or self.positiveDays * 10 < self.eligibleDays * 7
            or self.recentPositiveDays > self.positiveDays
        ):
            raise ValueError("Insufficient routine evidence")
        return self
