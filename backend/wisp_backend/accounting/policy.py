"""Pure admission and settlement decisions; SQL owns their atomic application."""

from collections.abc import Sequence
from dataclasses import dataclass
import math
from typing import Protocol

from wisp_backend.accounting.contracts import Usage
from wisp_backend.errors import ServiceError


ID_TTL = 86_400


class LedgerLimits(Protocol):
    @property
    def rate_limit(self) -> int: ...
    @property
    def concurrent_limit(self) -> int: ...
    @property
    def daily_requests(self) -> int: ...
    @property
    def daily_tokens(self) -> int: ...


def check_rate(limits: LedgerLimits, active: int, recent: Sequence[float], now: float) -> None:
    if active >= limits.concurrent_limit:
        raise ServiceError("rate_limited", 1000)
    if len(recent) >= limits.rate_limit:
        raise ServiceError("rate_limited", max(1, math.ceil((recent[0] + 60 - now) * 1000)))


def check_budget(limits: LedgerLimits, requests: int, committed_tokens: int, reservation: int, now: float) -> None:
    if requests >= limits.daily_requests or committed_tokens + reservation > limits.daily_tokens:
        next_day = (int(now // ID_TTL) + 1) * ID_TTL
        raise ServiceError("budget_exhausted", max(1, math.ceil((next_day - now) * 1000)))


@dataclass(frozen=True)
class Settlement:
    reserved_delta: int
    uncertain_delta: int
    confirmed_delta: int
    prompt_delta: int
    completion_delta: int
    state: str
    corrected: bool
    halt: bool
    cacheable: bool


def plan_settlement(state: str, corrected: bool, reservation: int, usage: Usage | None) -> Settlement | None:
    if state == "confirmed" or corrected or (state == "uncertain" and usage is None):
        return None
    return Settlement(
        reserved_delta=-reservation if state == "flight" else 0,
        uncertain_delta=(0 if usage else reservation) - (reservation if state == "uncertain" else 0),
        confirmed_delta=usage.total if usage else 0,
        prompt_delta=usage.prompt if usage else 0,
        completion_delta=usage.completion if usage else 0,
        state="confirmed" if usage else "uncertain",
        corrected=state == "uncertain",
        halt=usage is not None and usage.total > reservation,
        cacheable=state == "flight" and usage is not None,
    )
