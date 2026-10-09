"""A short model reaction to explicit user contact, separate from chat history."""
import asyncio
import json
from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from pydantic import BeforeValidator, ValidationError, field_validator

from wisp_backend.api.dependencies import get_chat_service
from wisp_backend.errors import ServiceError
from wisp_backend.prompts import SYSTEM_PROMPT
from wisp_backend.schemas import (
    CharacterContext, Contract, RequestId, Version, false_only, text_type, trim_text,
)
from wisp_backend.service import ChatService


class TouchEvent(Contract):
    type: Literal["user_touch"]
    variant: Literal["stroke", "touch", "ruffle", "poke"]


class TouchRequest(Contract):
    version: Version
    requestId: RequestId
    event: TouchEvent
    stream: Annotated[Literal[False], BeforeValidator(false_only)]
    locale: Literal["ru", "en"]
    character: CharacterContext


class TouchResponse(Contract):
    version: Version
    requestId: RequestId
    text: text_type(240)

    @field_validator("text")
    @classmethod
    def normalize_text(cls, value: str) -> str:
        return trim_text(value)


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


@router.post("/touch", response_model=TouchResponse)
async def touch(body: TouchRequest, service: Annotated[ChatService, Depends(get_chat_service)]) -> TouchResponse:
    settings = service.assistants["default"]
    try:
        reply = await asyncio.wait_for(
            service.providers[settings.provider].complete(build_touch_messages(body), settings), service.deadline,
        )
    except asyncio.TimeoutError:
        raise ServiceError("upstream_timeout") from None
    try:
        return TouchResponse(version=1, requestId=body.requestId, **reply.model_dump(exclude_none=True))
    except (ValidationError, AttributeError, TypeError):
        raise ServiceError("invalid_model_response") from None
