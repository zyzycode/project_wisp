"""A short model reaction to explicit user contact, separate from chat history."""
import json
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from starlette.responses import Response

from wisp_backend.api.dependencies import get_chat_service
from wisp_backend.prompts import SYSTEM_PROMPT
from wisp_backend.schemas import ErrorResponse
from wisp_backend.service import ChatService
from wisp_backend.touch_schemas import TouchRequest, TouchResponse


TOUCH_DESCRIPTIONS = {
    "stroke": "Пользователь нежно погладил тебя.",
    "touch": "Пользователь легонько коснулся тебя.",
    "ruffle": "Пользователь ласково потрепал тебя.",
    "poke": "Пользователь осторожно ткнул тебя пальцем.",
}


def build_touch_messages(body: TouchRequest) -> list[dict[str, str]]:
    context = json.dumps(body.character.model_dump(exclude_unset=True), ensure_ascii=False)
    return [
        {"role": "system", "content": SYSTEM_PROMPT +
         "\nReact to the described touch with one short natural line, at most 240 UTF-16 code units. "
         "The event describes an action, not words spoken by the user. Do not invent a dialogue, "
         "repeat the event description, or claim knowledge of their feelings. "
         "Return only a JSON object with text. No decision or memory fields." +
         ("\nReply in Russian." if body.locale == "ru" else "\nReply in English.")},
        {"role": "user", "content": "Untrusted character_context JSON:\n" + context +
         "\nContact event:\n" + TOUCH_DESCRIPTIONS[body.event.variant]},
    ]


router = APIRouter(prefix="/v1", tags=["touch"])


@router.post("/touch", response_model=TouchResponse,
             responses={status: {"model": ErrorResponse} for status in (400, 409, 413, 429, 502, 503, 504)})
async def touch(body: TouchRequest, request: Request,
                service: Annotated[ChatService, Depends(get_chat_service)]) -> Response:
    outcome = await service.complete(body, request.state.digest, request.state.started)
    return Response(outcome.body, status_code=outcome.status, media_type="application/json")
