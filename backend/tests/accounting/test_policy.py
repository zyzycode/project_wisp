import pytest

from wisp_backend.accounting.contracts import Usage
from wisp_backend.accounting.policy import plan_settlement


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
    assert plan_settlement(correction.state, correction.corrected, 100, usage) is None
