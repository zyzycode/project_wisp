"""Opt-in v5 branches from v3; local IDs and knowledge-v4 are forbidden."""

from typing import Annotated, Literal

from pydantic import BeforeValidator, Field, field_validator
from wisp_backend.api.schemas.common import ErrorResponse, RequestId, false_only
from wisp_backend.api.schemas.events import EventAwareChatRequest, EventAwareChatResponse
from wisp_backend.completion.replies import SummaryModelReply
from wisp_backend.validation import Contract, omittable, text_type


def version_five(value: object) -> int:
    if type(value) is not int or value != 5:
        raise ValueError("Expected integer version 5")
    return value


VersionFive = Annotated[Literal[5], BeforeValidator(version_five)]


class SummaryPair(Contract):
    userText: text_type(240)
    assistantText: text_type(2000)


class SummaryRequest(Contract):
    version: VersionFive
    requestId: RequestId
    locale: Literal["ru", "en"]
    stream: Annotated[Literal[False], BeforeValidator(false_only)]
    pairs: list[SummaryPair] = Field(min_length=4, max_length=8)

    @field_validator("pairs")
    @classmethod
    def text_budget(cls, pairs: list[SummaryPair]) -> list[SummaryPair]:
        if sum(len((pair.userText + pair.assistantText).encode("utf-16-le")) // 2 for pair in pairs) > 8000:
            raise ValueError("Summary source budget")
        return pairs


class SummaryResponse(SummaryModelReply):
    version: VersionFive
    requestId: RequestId


class SummaryChatRequest(EventAwareChatRequest):
    version: VersionFive
    summary: SummaryModelReply = omittable()


class SummaryChatResponse(EventAwareChatResponse):
    version: VersionFive


class SummaryErrorResponse(ErrorResponse):
    version: VersionFive
