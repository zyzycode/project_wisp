"""Selected-memory fields of the unified chat and event contract."""

from typing import Annotated, Literal

from pydantic import Field, model_validator
from wisp_backend.api.schemas.causal_memory import CausalMemoryEpisode
from wisp_backend.api.schemas.memory_timestamp import Timestamp
from wisp_backend.completion.replies import MemoryFact
from wisp_backend.validation import Contract, text_type


class DialogueEpisode(Contract):
    kind: Literal["dialogue"]
    userText: text_type(240)
    assistantText: text_type(400)
    occurredAt: Timestamp


class CursorGameEpisode(Contract):
    kind: Literal["cursor_game"]
    outcome: Literal["caught", "missed", "lost_target", "cancelled"]
    executedMs: Annotated[float, Field(ge=0, le=60_000)]
    occurredAt: Timestamp


class CharacterPreference(Contract):
    key: Literal["activity.cursor_game"]
    value: Annotated[float, Field(ge=-100, le=100)]
    confidence: Annotated[float, Field(ge=0.5, le=1)]


def memory_text_units(value: object) -> int:
    if isinstance(value, str):
        return len(value.encode("utf-16-le")) // 2
    if isinstance(value, dict):
        return sum(memory_text_units(item) for item in value.values())
    if isinstance(value, list):
        return sum(memory_text_units(item) for item in value)
    return 0


class MemoryContext(Contract):
    facts: list[MemoryFact] = Field(max_length=5)
    episodes: list[
        Annotated[DialogueEpisode | CursorGameEpisode | CausalMemoryEpisode, Field(discriminator="kind")]
    ] = Field(max_length=2)
    characterPreferences: list[CharacterPreference] = Field(max_length=1)

    @model_validator(mode="after")
    def bounded_projection(self) -> "MemoryContext":
        if len({fact.key for fact in self.facts}) != len(self.facts):
            raise ValueError("Duplicate fact key")
        if sum(isinstance(episode, CursorGameEpisode) for episode in self.episodes) > 1:
            raise ValueError("Too many cursor game episodes")
        if sum(isinstance(episode, CausalMemoryEpisode) for episode in self.episodes) > 1:
            raise ValueError("Too many causal episodes")
        if memory_text_units(self.model_dump()) > 2400:
            raise ValueError("Memory text budget exceeded")
        return self
