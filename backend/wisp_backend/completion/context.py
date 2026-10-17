"""Internal context values and deterministic selection, independent of any API."""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal


ContextSource = Literal["server_instructions", "desktop_character", "desktop_memory",
                        "server_examples", "desktop_event", "previous_ai", "dialogue", "lore", "summary", "summary_sources"]


@dataclass(frozen=True)
class ContextMessage:
    role: Literal["system", "user", "assistant"]
    content: str


@dataclass(frozen=True)
class ContextBlock:
    key: str
    source: ContextSource
    required: bool
    priority: int
    order: int
    messages: tuple[ContextMessage, ...]

    def __post_init__(self) -> None:
        if self.source != "server_instructions" and any(item.role == "system" for item in self.messages):
            raise ValueError("Only server instructions may use the system role")


class ContextOverflow(ValueError):
    def __init__(self) -> None:
        super().__init__("Required context exceeds the inference budget")


def render_messages(blocks: tuple[ContextBlock, ...]) -> list[dict[str, str]]:
    return [{"role": message.role, "content": message.content}
            for block in sorted(blocks, key=lambda item: (item.order, item.key)) for message in block.messages]


def select_context(blocks: tuple[ContextBlock, ...], input_budget: int,
                   estimate: Callable[[tuple[ContextBlock, ...]], int]) -> tuple[ContextBlock, ...]:
    """Reserve mandatory content first; keep a contiguous suffix of dialogue pairs.

    Admission priority and serialization order are deliberately separate. No text
    slicing, role promotion, token-driven output-cap reduction or random choices.
    """
    selected = tuple(block for block in blocks if block.required)
    if estimate(selected) > input_budget:
        raise ContextOverflow()
    history_full = False
    optional = sorted((block for block in blocks if not block.required),
                      key=lambda item: (-item.priority, -item.order, item.key))
    for block in optional:
        if history_full and block.source == "dialogue":
            continue
        candidate = (*selected, block)
        if estimate(candidate) <= input_budget:
            selected = candidate
        elif block.source == "dialogue":
            history_full = True
    return tuple(sorted(selected, key=lambda item: (item.order, item.key)))
