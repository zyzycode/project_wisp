"""Scenario-specific internal inputs, independent of HTTP schemas.

Snapshots are already validated by the wire adapter and only serialized here;
they deliberately do not duplicate the nested wire schemas. Fields interpreted
by prompt builders have explicit types. Required scenario inputs cannot be
omitted from their constructors.
"""

from dataclasses import dataclass, field
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
class ExpressionContext:
    pace: Literal["gentle", "normal"]
    trust: Literal["guarded", "familiar", "close"]
    attention: Literal["high", "ordinary"]
    play: Literal["high", "ordinary"]
    romance_allowed: bool


@dataclass(frozen=True)
class CharacterPromptContext:
    locale: Locale
    character: Snapshot
    expression: ExpressionContext = field(kw_only=True)
    user_consent_enabled: bool = field(kw_only=True)


@dataclass(frozen=True, kw_only=True)
class InteractionChatContext(CharacterPromptContext):
    messages: tuple[DialogueTurn, ...]
    memory: Snapshot
    interaction: InteractionContext
    previous_initiative: Snapshot | None = None
    summary: str | None = None
    previous_touch: Snapshot | None = None
    dialogue_topic: Snapshot | None = None
    lore: LoreCatalogue | None = None

    def __post_init__(self) -> None:
        if not self.messages or len(self.messages) % 2 != 1:
            raise ValueError("Chat requires complete history pairs and a current user turn")
        for index, turn in enumerate(self.messages):
            if turn.role != ("user" if index % 2 == 0 else "assistant"):
                raise ValueError("Chat dialogue roles must alternate from user")


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
    InteractionChatContext | InteractionTouchContext | EventContext | ObservationContext | SummaryContext
)
