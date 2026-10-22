"""Isolated v1 observation; shares the existing admission and cancellation boundary."""

from typing import Annotated

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response
from wisp_backend.api.dependencies import get_completion_service
from wisp_backend.api.dispatch import prepare_job
from wisp_backend.api.endpoints import OBSERVATION
from wisp_backend.api.responses import http_response
from wisp_backend.api.schemas.common import ErrorResponse as ObservationErrorResponse
from wisp_backend.api.schemas.observation import ObservationRequest
from wisp_backend.completion.service import CompletionService

router = APIRouter(tags=["foreground observation"])


@router.post(
    OBSERVATION.path,
    response_model=OBSERVATION.response_type,
    responses={status: {"model": ObservationErrorResponse} for status in (400, 409, 413, 429, 502, 503, 504)},
)
async def observation(
    body: ObservationRequest, request: Request, service: Annotated[CompletionService, Depends(get_completion_service)]
) -> Response:
    outcome = await service.complete(prepare_job(body), request.state.digest, request.state.started)
    return http_response(outcome)
