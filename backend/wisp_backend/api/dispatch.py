"""Translate validated wire input into a transport-independent execution job."""

from typing import TypeAlias, TypedDict

from wisp_backend.api.endpoints import ENDPOINTS_BY_REQUEST
from wisp_backend.api.responses import WireReplyEncoder
from wisp_backend.api.schemas.chat import ChatRequest
from wisp_backend.api.schemas.events import EventAwareChatRequest, EventRequest
from wisp_backend.api.schemas.interaction import InteractionChatRequest, InteractionTouchRequest
from wisp_backend.api.schemas.memory import MemoryRequest
from wisp_backend.api.schemas.observation import ObservationRequest
from wisp_backend.api.schemas.summary import SummaryChatRequest, SummaryRequest
from wisp_backend.api.schemas.touch import TouchRequest
from wisp_backend.completion.contracts import CompletionJob, InferenceRequest
from wisp_backend.completion.policies import POLICIES
from wisp_backend.completion.prompts.context import (
    ChatContext,
    DialogueTurn,
    EventChatContext,
    EventContext,
    InteractionChatContext,
    InteractionContext,
    InteractionTouchContext,
    Locale,
    MemoryChatContext,
    ObservationContext,
    PromptContext,
    Snapshot,
    SummaryChatContext,
    SummaryContext,
    SummaryPair,
    TouchContext,
)
from wisp_backend.completion.prompts.lore import LoreCatalogue
from wisp_backend.validation import trim_text

CompletionRequest: TypeAlias = (
    InteractionChatRequest
    | InteractionTouchRequest
    | ObservationRequest
    | SummaryRequest
    | SummaryChatRequest
    | ChatRequest
    | TouchRequest
    | MemoryRequest
    | EventRequest
)


class ChatInputs(TypedDict):
    locale: Locale
    character: Snapshot
    messages: tuple[DialogueTurn, ...]
    lore: LoreCatalogue | None


def prepare_chat_context(body: ChatRequest, lore: LoreCatalogue | None) -> ChatContext:
    common: ChatInputs = {
        "locale": body.locale,
        "character": body.character.model_dump(exclude_unset=True),
        "messages": tuple(DialogueTurn(item.role, trim_text(item.content)) for item in body.messages),
        "lore": lore,
    }
    if not isinstance(body, MemoryRequest):
        return ChatContext(**common)
    memory = body.memory.model_dump()
    if not isinstance(body, EventAwareChatRequest):
        return MemoryChatContext(**common, memory=memory)
    initiative = body.previousInitiative.model_dump() if body.previousInitiative is not None else None
    if not isinstance(body, SummaryChatRequest):
        return EventChatContext(**common, memory=memory, previous_initiative=initiative)
    summary = body.summary.text if body.summary is not None else None
    if not isinstance(body, InteractionChatRequest):
        return SummaryChatContext(**common, memory=memory, previous_initiative=initiative, summary=summary)
    return InteractionChatContext(
        **common,
        memory=memory,
        previous_initiative=initiative,
        summary=summary,
        interaction=InteractionContext(body.card.model_dump(), body.effectPolicy),
        previous_touch=body.previousTouch.model_dump() if body.previousTouch is not None else None,
    )


def prepare_context(body: CompletionRequest, lore: LoreCatalogue | None = None) -> PromptContext:
    """Keep wire inheritance and normalization in the API adapter only."""
    if isinstance(body, SummaryRequest):
        return SummaryContext(body.locale, tuple(SummaryPair(pair.userText, pair.assistantText) for pair in body.pairs))
    if isinstance(body, ChatRequest):
        return prepare_chat_context(body, lore)
    character = body.character.model_dump(exclude_unset=True)
    if isinstance(body, InteractionTouchRequest):
        return InteractionTouchContext(
            body.locale, character, InteractionContext(body.card.model_dump(), body.effectPolicy)
        )
    if isinstance(body, TouchRequest):
        return TouchContext(body.locale, character, body.event.variant)
    if isinstance(body, EventRequest):
        return EventContext(body.locale, character, body.memory.model_dump(), body.event.model_dump())
    if isinstance(body, ObservationRequest):
        return ObservationContext(body.locale, character, body.observation.appName, body.observation.windowTitle)
    raise TypeError("Unsupported completion request")


def prepare_job(body: CompletionRequest, lore: LoreCatalogue | None = None) -> CompletionJob:
    endpoint = ENDPOINTS_BY_REQUEST[type(body)]
    policy = POLICIES[endpoint.scenario]
    context = prepare_context(body, lore)
    quote = trim_text(body.messages[-1].content) if isinstance(body, ChatRequest) else None
    effect_policy = (
        context.interaction.effect_policy
        if isinstance(context, (InteractionChatContext, InteractionTouchContext))
        else None
    )
    return CompletionJob(
        request_id=body.requestId,
        inference=InferenceRequest(policy.build_blocks(context), policy.max_output_tokens, policy.context_window),
        timeout=policy.timeout,
        encoder=WireReplyEncoder(body.requestId, body.version, policy, endpoint.response_type, quote, effect_policy),
    )
