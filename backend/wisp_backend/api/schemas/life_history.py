"""Ordinary-chat reflection and explicit life-event summary wire schemas."""

import json
from datetime import date
from typing import Annotated, Literal

from pydantic import BeforeValidator, Field, StrictInt, model_validator
from wisp_backend.api.schemas.common import RequestId, false_only
from wisp_backend.api.schemas.memory_timestamp import Timestamp
from wisp_backend.validation import Contract, text_type


def _date_range(first: str, last: str) -> int:
    start, end = date.fromisoformat(first), date.fromisoformat(last)
    if start.isoformat() != first or end.isoformat() != last or not 0 <= (end - start).days <= 13:
        raise ValueError("Invalid observed UTC date range")
    return (end - start).days + 1


class LifeReflection(Contract):
    scope: Literal["observed_utc_window"]
    validity: Literal["tentative"]
    kind: Literal["shared_game_completions"]
    fromDate: text_type(10)
    throughDate: text_type(10)
    completedCount: StrictInt = Field(ge=6, le=1000)
    interruptedCount: StrictInt = Field(ge=0, le=1000)
    completedDays: StrictInt = Field(ge=3, le=14)

    @model_validator(mode="after")
    def evidence_shape(self) -> "LifeReflection":
        span = _date_range(self.fromDate, self.throughDate)
        if self.completedDays > span or self.completedCount < self.completedDays:
            raise ValueError("Incoherent observed dates")
        total = self.completedCount + self.interruptedCount
        if total > 1000 or 10 * self.completedCount < 7 * total:
            raise ValueError("Incoherent observed counts")
        if len(json.dumps(self.model_dump(), ensure_ascii=False, separators=(",", ":")).encode("utf-8")) > 512:
            raise ValueError("Life reflection exceeds byte limit")
        return self


class LifeSummaryEvent(Contract):
    activity: Literal["cursor_game"]
    outcome: Literal["completed", "cancelled", "failed"]
    cause: Literal["completed", "user_interrupted", "environment_lost", "timeout"]
    actor: Literal["user", "system", "autonomy", "unknown"]
    participation: Literal["user_engaged", "solitary", "none"]
    executedMs: Annotated[float, Field(ge=0, le=600000)]
    occurredAt: Timestamp

    @model_validator(mode="after")
    def causal_shape(self) -> "LifeSummaryEvent":
        if (self.outcome == "completed") != (self.cause == "completed"):
            raise ValueError("Incoherent terminal cause")
        if self.cause in ("environment_lost", "timeout") and self.actor != "system":
            raise ValueError("Incoherent environment actor")
        if self.cause == "user_interrupted" and (self.actor != "user" or self.outcome != "cancelled"):
            raise ValueError("Incoherent interruption actor")
        return self


class LifeSummaryRequest(Contract):
    requestId: RequestId
    locale: Literal["ru", "en"]
    stream: Annotated[Literal[False], BeforeValidator(false_only)]
    fromDate: text_type(10)
    throughDate: text_type(10)
    events: list[LifeSummaryEvent] = Field(min_length=4, max_length=8)

    @model_validator(mode="after")
    def source_range(self) -> "LifeSummaryRequest":
        _date_range(self.fromDate, self.throughDate)
        dates = [event.occurredAt[:10] for event in self.events]
        times = [event.occurredAt for event in self.events]
        if any(day < self.fromDate or day > self.throughDate for day in dates) or times != sorted(times):
            raise ValueError("Incoherent selected chronology")
        if len(json.dumps(self.model_dump(), ensure_ascii=False, separators=(",", ":")).encode("utf-8")) > 8192:
            raise ValueError("Life summary input exceeds byte limit")
        return self


class LifeSummaryContext(Contract):
    sourceKind: Literal["life_events"]
    text: text_type(1200)
    fromDate: text_type(10)
    throughDate: text_type(10)
    eventCount: StrictInt = Field(ge=4, le=8)

    @model_validator(mode="after")
    def selected_range(self) -> "LifeSummaryContext":
        _date_range(self.fromDate, self.throughDate)
        return self
