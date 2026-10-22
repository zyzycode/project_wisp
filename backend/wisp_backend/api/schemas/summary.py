"""Explicit summary requests and replies; no local IDs or knowledge cards."""

from typing import Annotated, Literal

from pydantic import BeforeValidator, Field, field_validator
from wisp_backend.api.schemas.common import RequestId, Version, false_only
from wisp_backend.completion.replies import SummaryModelReply
from wisp_backend.validation import Contract, text_type


class SummaryPair(Contract):
    userText: text_type(240)
    assistantText: text_type(2000)


class SummaryRequest(Contract):
    version: Version
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
    version: Version
    requestId: RequestId
