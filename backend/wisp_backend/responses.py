"""Validate and serialize terminal wire outcomes before durable accounting/replay."""
from pydantic import ValidationError
from starlette.responses import JSONResponse

from wisp_backend.completion_policy import CompletionRequest, model_reply_type, reply_context
from wisp_backend.contracts import Outcome, ProviderResult
from wisp_backend.errors import ERROR_STATUS, ServiceError
from wisp_backend.events_schemas import (
    EventAwareChatRequest, EventAwareChatResponse, EventErrorResponse, EventRequest, EventResponse,
)
from wisp_backend.memory_schemas import MemoryErrorResponse, MemoryRequest, MemoryResponse
from wisp_backend.schemas import ChatResponse, ErrorCode, ErrorDetail, ErrorResponse, trim_text
from wisp_backend.touch_schemas import TouchRequest, TouchResponse

MAX_RESPONSE_BYTES = 16 * 1024


def failure(code: ErrorCode, request_id: str | None, retry_after_ms: int | None = None,
            version: int = 1) -> Outcome:
    error = ErrorDetail(code=code, **({"retryAfterMs": retry_after_ms} if retry_after_ms is not None else {}))
    response_type = EventErrorResponse if version == 3 else MemoryErrorResponse if version == 2 else ErrorResponse
    body = response_type(version=version, requestId=request_id, error=error).model_dump(exclude_none=True)
    body["requestId"] = request_id
    return Outcome(ERROR_STATUS[code], JSONResponse(body).body)


def _response_type(body: CompletionRequest) -> type[
    ChatResponse | MemoryResponse | EventAwareChatResponse | TouchResponse | EventResponse
]:
    if isinstance(body, EventRequest):
        return EventResponse
    if isinstance(body, EventAwareChatRequest):
        return EventAwareChatResponse
    if isinstance(body, TouchRequest):
        return TouchResponse
    if isinstance(body, MemoryRequest):
        return MemoryResponse
    return ChatResponse


def success(body: CompletionRequest, result: ProviderResult) -> Outcome:
    """Revalidate any provider implementation; never let validation discard usage.

    The caller retains ProviderResult for settlement even when this raises. Exact
    response bytes are produced once so a replay cannot change the wire envelope.
    """
    if not isinstance(result, ProviderResult):
        raise ServiceError("invalid_model_response")
    if result.error:
        raise ServiceError(result.error)
    model_type = model_reply_type(reply_context(body))
    if isinstance(body, (TouchRequest, EventRequest)) and not isinstance(result.reply, model_type):
        raise ServiceError("invalid_model_response")
    context = {"evidence_quote": None if isinstance(body, (TouchRequest, EventRequest))
               else trim_text(body.messages[-1].content)}
    try:
        if result.reply is None:
            raise ServiceError("invalid_model_response")
        reply = model_type.model_validate(result.reply.model_dump(exclude_none=True), context=context)
        response = _response_type(body).model_validate(
            {"version": body.version, "requestId": body.requestId, **reply.model_dump(exclude_none=True)},
            context=context,
        )
        outcome = Outcome(200, JSONResponse(response.model_dump(exclude_none=True)).body)
    except (ValidationError, AttributeError, TypeError):
        raise ServiceError("invalid_model_response") from None
    if len(outcome.body) > MAX_RESPONSE_BYTES:
        raise ServiceError("payload_too_large")
    return outcome
