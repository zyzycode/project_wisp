"""Explicit v7 interaction routes use the same admission/service/provider lifecycle."""

from typing import Annotated

from fastapi import APIRouter, Depends, Request
from starlette.responses import Response
from wisp_backend.api.dependencies import get_completion_service
from wisp_backend.api.dispatch import prepare_job
from wisp_backend.api.endpoints import INTERACTION_CHAT, INTERACTION_TOUCH
from wisp_backend.api.responses import http_response
from wisp_backend.api.schemas.interaction import (
    InteractionChatRequest,
    InteractionErrorResponse,
    InteractionTouchRequest,
)
from wisp_backend.completion.service import CompletionService

router = APIRouter(tags=["interactions"])
ERRORS = {status: {"model": InteractionErrorResponse} for status in (400, 409, 413, 429, 502, 503, 504)}


@router.post(INTERACTION_TOUCH.path, response_model=INTERACTION_TOUCH.response_type, responses=ERRORS)
async def touch(
    body: InteractionTouchRequest,
    request: Request,
    service: Annotated[CompletionService, Depends(get_completion_service)],
) -> Response:
    outcome = await service.complete(prepare_job(body), request.state.digest, request.state.started)
    return http_response(outcome)


@router.post(
    INTERACTION_CHAT.path,
    response_model=INTERACTION_CHAT.response_type,
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
