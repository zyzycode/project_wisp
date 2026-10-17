from typing import Annotated

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response

from wisp_backend.api.dependencies import get_completion_service
from wisp_backend.api.dispatch import prepare_job
from wisp_backend.api.endpoints import CHAT
from wisp_backend.api.responses import http_response
from wisp_backend.api.schemas.chat import ChatRequest
from wisp_backend.api.schemas.common import ErrorResponse
from wisp_backend.completion.service import CompletionService


router = APIRouter(tags=["chat"])


@router.post(CHAT.path, response_model=CHAT.response_type, response_model_exclude_none=True,
             responses={status: {"model": ErrorResponse} for status in (400, 409, 413, 429, 502, 503, 504)})
async def chat(body: ChatRequest, request: Request, service: Annotated[CompletionService, Depends(get_completion_service)]) -> Response:
    outcome = await service.complete(prepare_job(body, request.app.state.lore_catalogue), request.state.digest, request.state.started, request.state.legacy_digest)
    return http_response(outcome)
