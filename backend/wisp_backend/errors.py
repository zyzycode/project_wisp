"""Safe error vocabulary shared across execution and adapters."""

from typing import Literal


ErrorCode = Literal["invalid_request", "unsupported_version", "payload_too_large", "request_conflict",
                    "request_in_progress", "rate_limited", "budget_exhausted", "upstream_unavailable",
                    "upstream_timeout", "invalid_model_response"]

class ServiceError(Exception):
    def __init__(self, code: ErrorCode, retry_after_ms: int | None = None) -> None:
        super().__init__(code)
        self.code = code
        self.retry_after_ms = retry_after_ms
