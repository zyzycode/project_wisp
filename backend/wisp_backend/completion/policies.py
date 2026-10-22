"""Each scenario owns its prompt, semantic reply, time and generation budgets."""

from collections.abc import Callable
from dataclasses import dataclass
from enum import Enum
from typing import Generic, TypeVar

from wisp_backend.completion.context import ContextBlock
from wisp_backend.completion.interaction_replies import InteractionChatReply, InteractionTouchReply
from wisp_backend.completion.prompts.context import (
    EventContext,
    InteractionChatContext,
    InteractionTouchContext,
    ObservationContext,
    PromptContext,
    SummaryContext,
)
from wisp_backend.completion.prompts.events import build_event_blocks
from wisp_backend.completion.prompts.interaction import build_interaction_chat_blocks, build_interaction_touch_blocks
from wisp_backend.completion.prompts.observation import build_observation_blocks
from wisp_backend.completion.prompts.summary import build_summary_blocks
from wisp_backend.completion.replies import CompletionReply, EventModelReply, SummaryModelReply
from wisp_backend.json_codec import decode_json


class Scenario(Enum):
    INTERACTION_TOUCH = "interaction_touch"
    INTERACTION_CHAT = "interaction_chat"
    OBSERVATION = "observation"
    SUMMARY = "summary"
    EVENT = "event"


ContextInput = TypeVar("ContextInput", bound=PromptContext)


@dataclass(frozen=True)
class CompletionPolicy(Generic[ContextInput]):
    context_type: type[ContextInput]
    block_builder: Callable[[ContextInput], tuple[ContextBlock, ...]]
    reply_type: type[CompletionReply]
    timeout: float = 10
    max_output_tokens: int | None = None
    context_window: int | None = None

    def build_blocks(self, context: PromptContext) -> tuple[ContextBlock, ...]:
        # Exact types also prevent accidentally routing a request to an unrelated scenario.
        if not isinstance(context, self.context_type) or type(context) is not self.context_type:
            raise TypeError("Prompt context does not match the completion scenario")
        return self.block_builder(context)

    def parse_reply(self, text: str, evidence_quote: str | None, effect_policy: str | None = None) -> CompletionReply:
        return self.reply_type.model_validate(
            decode_json(text), context={"evidence_quote": evidence_quote, "effect_policy": effect_policy}
        )


POLICIES = {
    Scenario.INTERACTION_TOUCH: CompletionPolicy(
        InteractionTouchContext,
        build_interaction_touch_blocks,
        InteractionTouchReply,
        max_output_tokens=1024,
        context_window=16384,
    ),
    Scenario.INTERACTION_CHAT: CompletionPolicy(
        InteractionChatContext,
        build_interaction_chat_blocks,
        InteractionChatReply,
        max_output_tokens=4096,
        context_window=16384,
    ),
    Scenario.OBSERVATION: CompletionPolicy(
        ObservationContext,
        build_observation_blocks,
        EventModelReply,
        timeout=2.5,
        max_output_tokens=1024,
        context_window=16384,
    ),
    Scenario.SUMMARY: CompletionPolicy(
        SummaryContext, build_summary_blocks, SummaryModelReply, max_output_tokens=512, context_window=8192
    ),
    Scenario.EVENT: CompletionPolicy(
        EventContext, build_event_blocks, EventModelReply, timeout=2.5, max_output_tokens=1024
    ),
}
