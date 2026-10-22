"""Closed author-resource schema; roles, budgets and constraints remain code-owned."""

from typing import Annotated

from pydantic import ConfigDict, Field, StrictInt
from wisp_backend.validation import Contract, text_type

Identifier = Annotated[str, Field(pattern=r"^[A-Za-z0-9._-]{1,64}$")]


class PromptTexts(Contract):
    model_config = ConfigDict(frozen=True)

    chat_intro: text_type(12000)
    touch_intro: text_type(12000)
    event_intro: text_type(12000)
    expression: text_type(12000)
    gentle: text_type(12000)
    company: text_type(12000)
    play: text_type(12000)
    trust: text_type(12000)
    variation: text_type(12000)


class ChatExample(Contract):
    id: Identifier
    state: text_type(1200)
    user: text_type(1200)
    alternatives: list[text_type(1200)] = Field(min_length=1, max_length=2)


class TouchExample(Contract):
    id: Identifier
    state: text_type(1200)
    situation: text_type(1200)
    alternatives: list[text_type(1200)] = Field(min_length=1, max_length=2)


class EventExample(Contract):
    id: Identifier
    situation: text_type(1200)
    wisp: text_type(1200)


class LocaleExamples(Contract):
    chat: list[ChatExample] = Field(max_length=32)
    touch: list[TouchExample] = Field(max_length=32)
    event: list[EventExample] = Field(max_length=32)


class Examples(Contract):
    ru: LocaleExamples
    en: LocaleExamples


class ResourceDocument(Contract):
    format: StrictInt = Field(ge=1, le=1)
    revision: Identifier
    texts: PromptTexts
    examples: Examples
