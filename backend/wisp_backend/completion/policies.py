"""Each scenario owns its prompt, semantic reply, time and generation budgets."""

from collections.abc import Callable
from dataclasses import dataclass
from enum import Enum

from wisp_backend.completion.context import ContextBlock
from wisp_backend.completion.prompts.chat import build_chat_blocks
from wisp_backend.completion.prompts.context import PromptContext
from wisp_backend.completion.prompts.events import build_event_blocks
from wisp_backend.completion.prompts.summary import build_summary_blocks
from wisp_backend.completion.prompts.touch import build_touch_blocks
from wisp_backend.completion.replies import (
    CompletionReply, SummaryModelReply, EventModelReply, MemoryModelReply, ModelReply, TouchModelReply,
)
from wisp_backend.json_codec import decode_json


class Scenario(Enum):
    SUMMARY = "summary"
    SUMMARY_CHAT = "summary_chat"
    CHAT = "chat"
    MEMORY_CHAT = "memory_chat"
    EVENT_CHAT = "event_chat"
    TOUCH = "touch"
    EVENT = "event"


@dataclass(frozen=True)
class CompletionPolicy:
    build_blocks: Callable[[PromptContext], tuple[ContextBlock, ...]]
    reply_type: type[CompletionReply]
    timeout: float = 10
    max_output_tokens: int | None = None
    context_window: int | None = None

    def parse_reply(self, text: str, evidence_quote: str | None) -> CompletionReply:
        return self.reply_type.model_validate(decode_json(text), context={"evidence_quote": evidence_quote})


POLICIES = {
    Scenario.SUMMARY: CompletionPolicy(build_summary_blocks, SummaryModelReply, max_output_tokens=512, context_window=8192),
    Scenario.SUMMARY_CHAT: CompletionPolicy(build_chat_blocks, MemoryModelReply),
    Scenario.CHAT: CompletionPolicy(build_chat_blocks, ModelReply),
    Scenario.MEMORY_CHAT: CompletionPolicy(build_chat_blocks, MemoryModelReply),
    Scenario.EVENT_CHAT: CompletionPolicy(build_chat_blocks, MemoryModelReply),
    Scenario.TOUCH: CompletionPolicy(build_touch_blocks, TouchModelReply),
    Scenario.EVENT: CompletionPolicy(build_event_blocks, EventModelReply, timeout=2.5, max_output_tokens=1024),
}
