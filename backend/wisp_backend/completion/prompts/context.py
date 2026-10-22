"""Scenario-specific internal inputs, independent of HTTP schemas.

Snapshots are already validated by the wire adapter and only serialized here;
they deliberately do not duplicate the nested wire schemas. Fields interpreted
by prompt builders have explicit types. Required scenario inputs cannot be
omitted from their constructors.
"""

from dataclasses import dataclass
from typing import Literal, TypeAlias

from wisp_backend.completion.prompts.lore import LoreCatalogue

Locale: TypeAlias = Literal["ru", "en"]
Snapshot: TypeAlias = dict[str, object]


@dataclass(frozen=True)
class DialogueTurn:
    role: Literal["user", "assistant"]
    content: str


@dataclass(frozen=True)
class SummaryPair:
    user_text: str
    assistant_text: str


@dataclass(frozen=True)
class InteractionContext:
    card: Snapshot
    effect_policy: Literal["eligible", "suppressed"]


@dataclass(frozen=True)
class CharacterPromptContext:
    locale: Locale
    character: Snapshot


@dataclass(frozen=True, kw_only=True)
class ChatContext(CharacterPromptContext):
    messages: tuple[DialogueTurn, ...]
    lore: LoreCatalogue | None = None

    def __post_init__(self) -> None:
        if not self.messages or len(self.messages) % 2 != 1:
            raise ValueError("Chat requires complete history pairs and a current user turn")
        for index, turn in enumerate(self.messages):
            if turn.role != ("user" if index % 2 == 0 else "assistant"):
                raise ValueError("Chat dialogue roles must alternate from user")


@dataclass(frozen=True, kw_only=True)
class MemoryChatContext(ChatContext):
    memory: Snapshot


@dataclass(frozen=True, kw_only=True)
class EventChatContext(MemoryChatContext):
    previous_initiative: Snapshot | None = None


@dataclass(frozen=True, kw_only=True)
class SummaryChatContext(EventChatContext):
    summary: str | None = None


@dataclass(frozen=True, kw_only=True)
class InteractionChatContext(SummaryChatContext):
    interaction: InteractionContext
    previous_touch: Snapshot | None = None


@dataclass(frozen=True)
class TouchContext(CharacterPromptContext):
    touch_variant: Literal["stroke", "touch", "ruffle", "poke"]


@dataclass(frozen=True)
class InteractionTouchContext(CharacterPromptContext):
    interaction: InteractionContext


@dataclass(frozen=True)
class EventContext(CharacterPromptContext):
    memory: Snapshot
    event: Snapshot


@dataclass(frozen=True)
class ObservationContext(CharacterPromptContext):
    app_name: str
    window_title: str


@dataclass(frozen=True)
class SummaryContext:
    locale: Locale
    pairs: tuple[SummaryPair, ...]


PromptContext: TypeAlias = (
    ChatContext | TouchContext | InteractionTouchContext | EventContext | ObservationContext | SummaryContext
)
