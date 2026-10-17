"""Normalized descriptive context for prompt construction; no wire envelopes."""

from dataclasses import dataclass, field
from typing import Literal

from wisp_backend.completion.prompts.lore import LoreCatalogue


@dataclass(frozen=True)
class PromptContext:
    locale: Literal["ru", "en"]
    character: dict[str, object]
    messages: list[dict[str, str]] = field(default_factory=list)
    memory: dict[str, object] | None = None
    previous_initiative: dict[str, object] | None = None
    event: dict[str, object] | None = None
    touch_variant: Literal["stroke", "touch", "ruffle", "poke"] | None = None
    lore: LoreCatalogue | None = None
    summary: str | None = None
    summary_pairs: list[dict[str, str]] = field(default_factory=list)
