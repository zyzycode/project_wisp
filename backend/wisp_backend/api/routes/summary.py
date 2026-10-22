"""Explicit summary inference and v1-compatible optional-summary chat."""

from typing import Annotated

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response
from wisp_backend.api.dependencies import get_completion_service
from wisp_backend.api.dispatch import prepare_job
from wisp_backend.api.endpoints import SUMMARY
from wisp_backend.api.responses import http_response
from wisp_backend.api.schemas.common import ErrorResponse as SummaryErrorResponse
from wisp_backend.api.schemas.summary import SummaryRequest
from wisp_backend.completion.service import CompletionService

router = APIRouter(tags=["explicit summary"])
ERRORS = {status: {"model": SummaryErrorResponse} for status in (400, 409, 413, 429, 502, 503, 504)}


@router.post(SUMMARY.path, response_model=SUMMARY.response_type, responses=ERRORS)
async def summary(
    body: SummaryRequest, request: Request, service: Annotated[CompletionService, Depends(get_completion_service)]
) -> Response:
    outcome = await service.complete(prepare_job(body), request.state.digest, request.state.started)
    return http_response(outcome)
