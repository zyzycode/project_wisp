"""Internal context values and deterministic selection, independent of any API."""

import json
from collections.abc import Awaitable, Callable, Generator
from dataclasses import dataclass
from typing import Literal

ContextSource = Literal[
    "server_instructions",
    "desktop_character",
    "desktop_memory",
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
class StructuredReplySchema:
    """Immutable backend-authored schema value; providers need no prompt/reply dependencies."""

    name: Literal["beverage_proposal"]
    document_json: str

    def document(self) -> dict[str, object]:
        return json.loads(self.document_json)


@dataclass(frozen=True)
class ContextBlock:
    key: str
    source: ContextSource
    required: bool
    priority: int
    order: int
    messages: tuple[ContextMessage, ...]
    response_schema: StructuredReplySchema | None = None
    server_instructions: str | None = None

    def __post_init__(self) -> None:
        if self.source != "server_instructions" and any(item.role == "system" for item in self.messages):
            raise ValueError("Only server instructions may use the system role")


def response_schema_for(blocks: tuple[ContextBlock, ...]) -> StructuredReplySchema | None:
    return next((block.response_schema for block in blocks if block.response_schema is not None), None)


class ContextOverflow(ValueError):
    def __init__(self) -> None:
        super().__init__("Required context exceeds the inference budget")


@dataclass(frozen=True)
class SelectionDecision:
    """Optional in-memory diagnostics; never contains prompt text or logs it."""

    key: str
    included: bool
    reason: str
    candidate_size: int | None


def _record(
    trace: list[SelectionDecision] | None, block: ContextBlock, included: bool, reason: str, size: int | None
) -> None:
    if trace is not None:
        trace.append(SelectionDecision(block.key, included, reason, size))


def render_messages(blocks: tuple[ContextBlock, ...]) -> list[dict[str, str]]:
    messages = []
    for block in sorted(blocks, key=lambda item: (item.order, item.key)):
        if block.server_instructions is not None:
            messages.append({"role": "system", "content": block.server_instructions})
        messages.extend({"role": message.role, "content": message.content} for message in block.messages)
    return messages


def _selection_steps(
    blocks: tuple[ContextBlock, ...],
    input_budget: int,
    *,
    full_first: bool = False,
    trace: list[SelectionDecision] | None = None,
) -> Generator[tuple[ContextBlock, ...], int, tuple[ContextBlock, ...]]:
    """One selection algorithm for local estimates and asynchronous model counts."""
    if full_first:
        full_size = yield blocks
        if full_size <= input_budget:
            for block in blocks:
                _record(trace, block, True, "required" if block.required else "full_context_fits", full_size)
            return tuple(sorted(blocks, key=lambda item: (item.order, item.key)))
    selected = tuple(block for block in blocks if block.required)
    required_size = yield selected
    if required_size > input_budget:
        for block in blocks:
            _record(
                trace, block, False, "required_overflow" if block.required else "not_evaluated_overflow", required_size
            )
        raise ContextOverflow()
    for block in selected:
        _record(trace, block, True, "required", required_size)
    history_full = False
    optional = sorted(
        (block for block in blocks if not block.required), key=lambda item: (-item.priority, -item.order, item.key)
    )
    for block in optional:
        if history_full and block.source == "dialogue":
            _record(trace, block, False, "history_suffix", None)
            continue
        candidate = (*selected, block)
        candidate_size = yield candidate
        if candidate_size <= input_budget:
            selected = candidate
            populated = bool(block.messages) or block.server_instructions is not None
            _record(trace, block, True, "selected" if populated else "empty_optional", candidate_size)
        else:
            _record(trace, block, False, "budget", candidate_size)
            if block.source == "dialogue":
                history_full = True
    return tuple(sorted(selected, key=lambda item: (item.order, item.key)))


def select_context(
    blocks: tuple[ContextBlock, ...],
    input_budget: int,
    estimate: Callable[[tuple[ContextBlock, ...]], int],
    *,
    trace: list[SelectionDecision] | None = None,
) -> tuple[ContextBlock, ...]:
    """Local selection: preserve mandatory blocks and a contiguous history suffix."""
    steps = _selection_steps(blocks, input_budget, trace=trace)
    candidate = next(steps)
    while True:
        size = estimate(candidate)
        try:
            candidate = steps.send(size)
        except StopIteration as done:
            return done.value


async def select_context_async(
    blocks: tuple[ContextBlock, ...],
    input_budget: int,
    count: Callable[[tuple[ContextBlock, ...]], Awaitable[int]],
    *,
    trace: list[SelectionDecision] | None = None,
) -> tuple[ContextBlock, ...]:
    """Count complete candidate payloads; do not add counts of individual blocks.

    Most bounded requests fit in one count call. Otherwise there are at most
    optional-block-count + 2 calls. Memoization lives only for this selection.
    """
    counts: dict[tuple[ContextBlock, ...], int] = {}
    steps = _selection_steps(blocks, input_budget, full_first=True, trace=trace)
    candidate = next(steps)
    while True:
        canonical = tuple(sorted(candidate, key=lambda item: (item.order, item.key)))
        if canonical not in counts:
            counts[canonical] = await count(canonical)
        try:
            candidate = steps.send(counts[canonical])
        except StopIteration as done:
            return done.value
