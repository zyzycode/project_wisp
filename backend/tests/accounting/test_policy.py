"""Accounting decisions can be verified without storage or application setup."""

from dataclasses import dataclass

import pytest

from wisp_backend.accounting.contracts import Usage
from wisp_backend.accounting.policy import ID_TTL, check_budget, check_rate, plan_settlement
from wisp_backend.errors import ServiceError


@dataclass(frozen=True)
class Limits:
    concurrent_limit: int = 2
    rate_limit: int = 3
    daily_requests: int = 10
    daily_tokens: int = 1000


@pytest.mark.parametrize("total", [0, 7, 100, 101, 10**40])
def test_late_correction_equals_immediate_accounting_but_cannot_publish(total: int) -> None:
    usage = Usage(total, 0, total)
    direct = plan_settlement("flight", False, 100, usage)
    abandoned = plan_settlement("flight", False, 100, None)
    correction = plan_settlement("uncertain", False, 100, usage)
    assert direct is not None and abandoned is not None and correction is not None
    for field in ("reserved_delta", "uncertain_delta", "confirmed_delta", "prompt_delta", "completion_delta"):
        assert getattr(abandoned, field) + getattr(correction, field) == getattr(direct, field)
    assert not abandoned.cacheable and not correction.cacheable and direct.cacheable
    assert direct.halt == correction.halt == (total > 100)
    assert plan_settlement(correction.state, correction.corrected, 100, usage) is None


def test_budget_boundary_and_utc_retry() -> None:
    now = ID_TTL - .5
    check_budget(Limits(), requests=9, committed_tokens=900, reservation=100, now=now)
    with pytest.raises(ServiceError) as exceeded:
        check_budget(Limits(), requests=9, committed_tokens=901, reservation=100, now=now)
    assert exceeded.value.code == "budget_exhausted" and exceeded.value.retry_after_ms == 500


def test_concurrency_rejection_precedes_rate_rejection() -> None:
    with pytest.raises(ServiceError) as denied:
        check_rate(Limits(), active=2, recent=[50, 51, 52], now=60)
    assert denied.value.retry_after_ms == 1000
    with pytest.raises(ServiceError) as rate:
        check_rate(Limits(), active=1, recent=[50, 51, 52], now=60)
    assert rate.value.retry_after_ms == 50_000
