"""Bounded ordinary-chat text-discussion context, independent of local evidence."""

import json
from typing import Literal

from pydantic import model_validator
from wisp_backend.validation import Contract

MusicTopic = Literal["jazz", "classical", "rock", "electronic"]


class MusicUserPreference(Contract):
    topic: MusicTopic
    disposition: Literal["like", "dislike"]


class MusicTopicContext(Contract):
    scope: Literal["text_discussion"]
    topic: MusicTopic
    characterInterest: Literal["unknown", "emerging", "established"]
    userPreference: MusicUserPreference | None = None
    intention: Literal["ask_music_detail"] | None = None

    @model_validator(mode="before")
    @classmethod
    def omitted_not_null(cls, value: object) -> object:
        if isinstance(value, dict) and any(item is None for item in value.values()):
            raise ValueError("Music context fields must be omitted rather than null")
        return value

    @model_validator(mode="after")
    def bounded_context(self) -> "MusicTopicContext":
        if self.characterInterest == "unknown" and self.userPreference is None and self.intention is None:
            raise ValueError("Music context has no admissible content")
        payload = self.model_dump(exclude_none=True)
        if len(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")) > 512:
            raise ValueError("Music context exceeds byte limit")
        return self
