"""Explicit v1 interaction routes use the same admission/service/provider lifecycle."""

from typing import Annotated

from fastapi import APIRouter, Depends, Request
from starlette.responses import Response
from wisp_backend.api.dependencies import get_completion_service
from wisp_backend.api.dispatch import prepare_job
from wisp_backend.api.endpoints import CHAT, TOUCH
from wisp_backend.api.responses import http_response
from wisp_backend.api.schemas.common import ErrorResponse as InteractionErrorResponse
from wisp_backend.api.schemas.interaction import InteractionChatRequest, InteractionTouchRequest
from wisp_backend.completion.service import CompletionService

router = APIRouter(tags=["interactions"])
ERRORS = {status: {"model": InteractionErrorResponse} for status in (400, 409, 413, 429, 502, 503, 504)}


@router.post(TOUCH.path, response_model=TOUCH.response_type, responses=ERRORS)
async def touch(
    body: InteractionTouchRequest,
    request: Request,
    service: Annotated[CompletionService, Depends(get_completion_service)],
) -> Response:
    outcome = await service.complete(prepare_job(body), request.state.digest, request.state.started)
    return http_response(outcome)


@router.post(
    CHAT.path,
    response_model=CHAT.response_type,
    response_model_exclude_none=True,
    responses=ERRORS,
)
async def chat(
    body: InteractionChatRequest,
    request: Request,
    service: Annotated[CompletionService, Depends(get_completion_service)],
) -> Response:
    outcome = await service.complete(
        prepare_job(body, request.app.state.lore_catalogue), request.state.digest, request.state.started
    )
    return http_response(outcome)
