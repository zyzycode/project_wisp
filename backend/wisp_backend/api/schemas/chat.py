"""Chat request fields."""

from typing import Annotated, Literal

from pydantic import BeforeValidator, Field, field_validator
from wisp_backend.api.schemas.common import CharacterContext, Event, Message, RequestId, false_only
from wisp_backend.validation import Contract


class ChatFields(Contract):
    requestId: RequestId
    event: Event
    messages: list[Message] = Field(min_length=1, max_length=21)
    stream: Annotated[Literal[False], BeforeValidator(false_only)]
    locale: Literal["ru", "en"]
    character: CharacterContext

    @field_validator("messages")
    @classmethod
    def alternating_messages(cls, messages: list[Message]) -> list[Message]:
        if len(messages) % 2 != 1 or any(
            item.role != ("user" if index % 2 == 0 else "assistant") for index, item in enumerate(messages)
        ):
            raise ValueError("Expected user, assistant, ..., user")
        if sum(len(item.content.encode("utf-16-le")) // 2 for item in messages[:-1]) > 8000:
            raise ValueError("History exceeds 8000 UTF-16 code units")
        return messages
