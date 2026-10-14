"""HTTP endpoint for an explicit contact reaction, separate from chat history."""

from typing import Annotated

from fastapi import APIRouter, Depends, Request
from starlette.responses import Response

from wisp_backend.api.dependencies import get_completion_service
from wisp_backend.api.dispatch import prepare_job
from wisp_backend.api.endpoints import TOUCH
from wisp_backend.api.responses import http_response
from wisp_backend.api.schemas.common import ErrorResponse
from wisp_backend.api.schemas.touch import TouchRequest
from wisp_backend.completion.service import CompletionService


router = APIRouter(tags=["touch"])


@router.post(TOUCH.path, response_model=TOUCH.response_type,
             responses={status: {"model": ErrorResponse} for status in (400, 409, 413, 429, 502, 503, 504)})
async def touch(body: TouchRequest, request: Request,
                service: Annotated[CompletionService, Depends(get_completion_service)]) -> Response:
    outcome = await service.complete(prepare_job(body), request.state.digest, request.state.started)
    return http_response(outcome)
