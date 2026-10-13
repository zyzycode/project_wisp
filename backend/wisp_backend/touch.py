"""HTTP endpoint for an explicit contact reaction, separate from chat history."""
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from starlette.responses import Response

from wisp_backend.api.dependencies import get_chat_service
from wisp_backend.schemas import ErrorResponse
from wisp_backend.service import ChatService
from wisp_backend.touch_schemas import TouchRequest, TouchResponse


router = APIRouter(prefix="/v1", tags=["touch"])


@router.post("/touch", response_model=TouchResponse,
             responses={status: {"model": ErrorResponse} for status in (400, 409, 413, 429, 502, 503, 504)})
async def touch(body: TouchRequest, request: Request,
                service: Annotated[ChatService, Depends(get_chat_service)]) -> Response:
    outcome = await service.complete(body, request.state.digest, request.state.started)
    return Response(outcome.body, status_code=outcome.status, media_type="application/json")
