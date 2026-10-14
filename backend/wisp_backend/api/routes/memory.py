"""Explicit v2 memory endpoint; shares service/ledger/lifecycle with v1."""

from typing import Annotated

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response

from wisp_backend.api.dependencies import get_completion_service
from wisp_backend.api.dispatch import prepare_job
from wisp_backend.api.endpoints import MEMORY_CHAT
from wisp_backend.api.responses import http_response
from wisp_backend.api.schemas.memory import MemoryRequest, MemoryErrorResponse
from wisp_backend.completion.service import CompletionService


router = APIRouter(tags=['memory chat'])


@router.post(MEMORY_CHAT.path, response_model=MEMORY_CHAT.response_type, response_model_exclude_none=True,
             responses={status: {'model': MemoryErrorResponse} for status in (400, 409, 413, 429, 502, 503, 504)})
async def chat(body: MemoryRequest, request: Request, service: Annotated[CompletionService, Depends(get_completion_service)]) -> Response:
    outcome = await service.complete(prepare_job(body), request.state.digest, request.state.started)
    return http_response(outcome)
