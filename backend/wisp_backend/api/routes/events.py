"""Explicit v1 event and follow-up chat endpoints sharing the existing ledger."""

from typing import Annotated

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response
from wisp_backend.api.dependencies import get_completion_service
from wisp_backend.api.dispatch import prepare_job
from wisp_backend.api.endpoints import EVENT
from wisp_backend.api.responses import http_response
from wisp_backend.api.schemas.common import ErrorResponse as EventErrorResponse
from wisp_backend.api.schemas.events import EventRequest
from wisp_backend.completion.service import CompletionService

router = APIRouter(tags=["companion events"])
ERROR_RESPONSES = {status: {"model": EventErrorResponse} for status in (400, 409, 413, 429, 502, 503, 504)}


@router.post(EVENT.path, response_model=EVENT.response_type, responses=ERROR_RESPONSES)
async def event(
    body: EventRequest, request: Request, service: Annotated[CompletionService, Depends(get_completion_service)]
) -> Response:
    outcome = await service.complete(prepare_job(body), request.state.digest, request.state.started)
    return http_response(outcome)
