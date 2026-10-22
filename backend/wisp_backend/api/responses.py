"""Semantic validation and HTTP serialization before accounting/replay."""

from dataclasses import dataclass

from pydantic import BaseModel, ValidationError
from starlette.responses import JSONResponse, Response
from wisp_backend.api.schemas.common import ErrorDetail, ErrorResponse
from wisp_backend.completion.policies import CompletionPolicy
from wisp_backend.errors import ErrorCode, ServiceError
from wisp_backend.outcomes import MAX_RESPONSE_BYTES, Outcome

ERROR_STATUS = {
    "invalid_request": 400,
    "unsupported_version": 400,
    "payload_too_large": 413,
    "request_conflict": 409,
    "request_in_progress": 409,
    "rate_limited": 429,
    "budget_exhausted": 429,
    "upstream_unavailable": 503,
    "upstream_timeout": 504,
    "invalid_model_response": 502,
}


def failure(code: ErrorCode, request_id: str | None, retry_after_ms: int | None = None, version: int = 1) -> Outcome:
    detail = ErrorDetail(code=code, **({"retryAfterMs": retry_after_ms} if retry_after_ms is not None else {}))
    body = ErrorResponse(version=version, requestId=request_id, error=detail).model_dump(exclude_none=True)
    body["requestId"] = request_id
    return Outcome(ERROR_STATUS[code], JSONResponse(body).body)


def http_response(outcome: Outcome) -> Response:
    return Response(outcome.body, status_code=outcome.status, media_type="application/json")


def error_response(
    code: ErrorCode, request_id: str | None = None, retry_after_ms: int | None = None, version: int = 1
) -> Response:
    return http_response(failure(code, request_id, retry_after_ms, version))


@dataclass(frozen=True)
class WireReplyEncoder:
    request_id: str
    version: int
    policy: CompletionPolicy
    response_type: type[BaseModel]
    evidence_quote: str | None = None
    effect_policy: str | None = None

    def success(self, text: str) -> Outcome:
        try:
            reply = self.policy.parse_reply(text, self.evidence_quote, self.effect_policy)
            response = self.response_type.model_validate(
                {"version": self.version, "requestId": self.request_id, **reply.model_dump(exclude_none=True)},
                context={"evidence_quote": self.evidence_quote, "effect_policy": self.effect_policy},
            )
            outcome = Outcome(200, JSONResponse(response.model_dump(exclude_none=True)).body)
        except (ValidationError, ValueError, TypeError, RecursionError):
            raise ServiceError("invalid_model_response") from None
        if len(outcome.body) > MAX_RESPONSE_BYTES:
            raise ServiceError("payload_too_large")
        return outcome

    def failure(self, code: ErrorCode, retry_after_ms: int | None = None) -> Outcome:
        return failure(code, self.request_id, retry_after_ms, self.version)
