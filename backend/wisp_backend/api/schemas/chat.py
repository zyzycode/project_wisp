"""Version 1 chat request and response envelopes."""

from typing import Annotated, Literal

from pydantic import BeforeValidator, ConfigDict, Field, field_validator

from wisp_backend.api.schemas.common import CharacterContext, Event, Message, RequestId, Version, false_only
from wisp_backend.completion.replies import ModelReply
from wisp_backend.validation import Contract


class ChatRequest(Contract):
    model_config = ConfigDict(
        extra="forbid", strict=True, allow_inf_nan=False,
        json_schema_extra=
        {'examples': [{'version': 1,
                       'requestId': '02d80270-1a72-47c9-a713-335b872ad24b',
                       'event': {'type': 'user_message'},
                       'messages': [{'role': 'user', 'content': 'Привет!'}],
                       'stream': False,
                       'locale': 'ru',
                       'character': {'needs': {'energy': 80,
                                               'attention': 50,
                                               'play': 60,
                                               'comfort': 80},
                                     'relationship': {'friendship': 100,
                                                      'love': 0,
                                                      'loveUnlocked': False},
                                     'personality': {'presetId': 'default',
                                                     'aiSelfConcept': 'Я Wisp, твой компаньон.',
                                                     'traits': {'shyness': 0.4,
                                                                'playfulness': 0.6,
                                                                'sensitivity': 0.5,
                                                                'boldness': 0.4}},
                                     'intimacy': {'flirtiness': 0,
                                                  'romanticCharge': 0,
                                                  'userConsentEnabled': False},
                                     'synthesizedTone': 'curious'}}]},
    )

    version: Version
    requestId: RequestId
    event: Event
    messages: list[Message] = Field(min_length=1, max_length=7)
    stream: Annotated[Literal[False], BeforeValidator(false_only)]
    locale: Literal["ru", "en"]
    character: CharacterContext

    @field_validator("messages")
    @classmethod
    def alternating_messages(cls, messages: list[Message]) -> list[Message]:
        if len(messages) % 2 != 1 or any(
            item.role != ("user" if index % 2 == 0 else "assistant")
            for index, item in enumerate(messages)
        ):
            raise ValueError("Expected user, assistant, ..., user")
        return messages


class ChatResponse(ModelReply):
    version: Version
    requestId: RequestId
