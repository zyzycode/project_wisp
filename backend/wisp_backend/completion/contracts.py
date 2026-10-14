"""Transport-independent input and output of one completion execution."""

from dataclasses import dataclass
from typing import Protocol

from wisp_backend.accounting.contracts import Usage
from wisp_backend.errors import ErrorCode
from wisp_backend.outcomes import Outcome


@dataclass(frozen=True)
class InferenceRequest:
    messages: list[dict[str, str]]
    max_output_tokens: int | None = None


@dataclass(frozen=True)
class ProviderResult:
    text: str | None = None
    usage: Usage | None = None
    error: ErrorCode | None = None


class ReplyEncoder(Protocol):
    """The caller owns semantic validation and its delivery envelope."""
    def success(self, text: str) -> Outcome: ...
    def failure(self, code: ErrorCode, retry_after_ms: int | None = None) -> Outcome: ...


@dataclass(frozen=True)
class CompletionJob:
    request_id: str
    inference: InferenceRequest
    timeout: float
    encoder: ReplyEncoder
