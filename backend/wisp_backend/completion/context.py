"""Internal context values and deterministic selection, independent of any API."""

from collections.abc import Awaitable, Callable, Generator
from dataclasses import dataclass
from typing import Literal

ContextSource = Literal[
    "server_instructions",
    "desktop_character",
    "desktop_memory",
    "server_examples",
    "desktop_event",
    "desktop_interaction",
    "previous_ai",
    "dialogue",
    "lore",
    "summary",
    "summary_sources",
    "observation",
]


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
    return [
        {"role": message.role, "content": message.content}
        for block in sorted(blocks, key=lambda item: (item.order, item.key))
        for message in block.messages
    ]


def _selection_steps(
    blocks: tuple[ContextBlock, ...], input_budget: int, *, full_first: bool = False
) -> Generator[tuple[ContextBlock, ...], int, tuple[ContextBlock, ...]]:
    """One selection algorithm for local estimates and asynchronous model counts."""
    if full_first and (yield blocks) <= input_budget:
        return tuple(sorted(blocks, key=lambda item: (item.order, item.key)))
    selected = tuple(block for block in blocks if block.required)
    if (yield selected) > input_budget:
        raise ContextOverflow()
    history_full = False
    optional = sorted(
        (block for block in blocks if not block.required), key=lambda item: (-item.priority, -item.order, item.key)
    )
    for block in optional:
        if history_full and block.source == "dialogue":
            continue
        candidate = (*selected, block)
        if (yield candidate) <= input_budget:
            selected = candidate
        elif block.source == "dialogue":
            history_full = True
    return tuple(sorted(selected, key=lambda item: (item.order, item.key)))


def select_context(
    blocks: tuple[ContextBlock, ...], input_budget: int, estimate: Callable[[tuple[ContextBlock, ...]], int]
) -> tuple[ContextBlock, ...]:
    """Local selection: preserve mandatory blocks and a contiguous history suffix."""
    steps = _selection_steps(blocks, input_budget)
    candidate = next(steps)
    while True:
        size = estimate(candidate)
        try:
            candidate = steps.send(size)
        except StopIteration as done:
            return done.value


async def select_context_async(
    blocks: tuple[ContextBlock, ...], input_budget: int, count: Callable[[tuple[ContextBlock, ...]], Awaitable[int]]
) -> tuple[ContextBlock, ...]:
    """Count complete candidate payloads; do not add counts of individual blocks.

    Most bounded requests fit in one count call. Otherwise there are at most
    optional-block-count + 2 calls. Memoization lives only for this selection.
    """
    counts: dict[tuple[ContextBlock, ...], int] = {}
    steps = _selection_steps(blocks, input_budget, full_first=True)
    candidate = next(steps)
    while True:
        canonical = tuple(sorted(candidate, key=lambda item: (item.order, item.key)))
        if canonical not in counts:
            counts[canonical] = await count(canonical)
        try:
            candidate = steps.send(counts[canonical])
        except StopIteration as done:
            return done.value
