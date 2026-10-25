"""Translate validated wire input into a transport-independent execution job."""

from typing import TypeAlias, TypedDict

from wisp_backend.api.endpoints import ENDPOINTS_BY_REQUEST
from wisp_backend.api.responses import WireReplyEncoder
from wisp_backend.api.schemas.common import CharacterContext
from wisp_backend.api.schemas.events import EventRequest
from wisp_backend.api.schemas.interaction import InteractionChatRequest, InteractionTouchRequest
from wisp_backend.api.schemas.observation import ObservationRequest
from wisp_backend.api.schemas.summary import SummaryRequest
from wisp_backend.completion.contracts import CompletionJob, InferenceRequest
from wisp_backend.completion.policies import POLICIES
from wisp_backend.completion.prompts.context import (
    DialogueTurn,
    EventContext,
    ExpressionContext,
    InteractionChatContext,
    InteractionContext,
    InteractionTouchContext,
    Locale,
    ObservationContext,
    PromptContext,
    Snapshot,
    SummaryContext,
    SummaryPair,
)
from wisp_backend.completion.prompts.lore import LoreCatalogue
from wisp_backend.validation import trim_text

CompletionRequest: TypeAlias = (
    InteractionChatRequest | InteractionTouchRequest | ObservationRequest | SummaryRequest | EventRequest
)


class ChatInputs(TypedDict):
    locale: Locale
    character: Snapshot
    messages: tuple[DialogueTurn, ...]
    lore: LoreCatalogue | None
    expression: ExpressionContext
    user_consent_enabled: bool


def expression_context(character: CharacterContext) -> ExpressionContext:
    value = character.expression
    return ExpressionContext(value.pace, value.trust, value.attention, value.play, value.romanceAllowed)


def prepare_chat_context(body: InteractionChatRequest, lore: LoreCatalogue | None) -> InteractionChatContext:
    common: ChatInputs = {
        "locale": body.locale,
        "character": body.character.model_dump(exclude_unset=True),
        "messages": tuple(DialogueTurn(item.role, trim_text(item.content)) for item in body.messages),
        "lore": lore,
        "expression": expression_context(body.character),
        "user_consent_enabled": body.character.intimacy.userConsentEnabled,
    }
    return InteractionChatContext(
        **common,
        memory=body.memory.model_dump(),
        previous_initiative=body.previousInitiative.model_dump() if body.previousInitiative is not None else None,
        summary=body.summary.text if body.summary is not None else None,
        interaction=InteractionContext(body.card.model_dump(), body.effectPolicy),
        previous_touch=body.previousTouch.model_dump() if body.previousTouch is not None else None,
        dialogue_topic=body.dialogueTopic.model_dump() if body.dialogueTopic is not None else None,
    )


def prepare_context(body: CompletionRequest, lore: LoreCatalogue | None = None) -> PromptContext:
    """Keep wire inheritance and normalization in the API adapter only."""
    if isinstance(body, SummaryRequest):
        return SummaryContext(body.locale, tuple(SummaryPair(pair.userText, pair.assistantText) for pair in body.pairs))
    if isinstance(body, InteractionChatRequest):
        return prepare_chat_context(body, lore)
    character = body.character.model_dump(exclude_unset=True)
    if isinstance(body, InteractionTouchRequest):
        return InteractionTouchContext(
            body.locale,
            character,
            InteractionContext(body.card.model_dump(), body.effectPolicy),
            expression=expression_context(body.character),
            user_consent_enabled=body.character.intimacy.userConsentEnabled,
        )
    if isinstance(body, EventRequest):
        return EventContext(
            body.locale,
            character,
            body.memory.model_dump(),
            body.event.model_dump(),
            expression=expression_context(body.character),
            user_consent_enabled=body.character.intimacy.userConsentEnabled,
        )
    if isinstance(body, ObservationRequest):
        return ObservationContext(
            body.locale,
            character,
            body.observation.appName,
            body.observation.windowTitle,
            expression=expression_context(body.character),
            user_consent_enabled=body.character.intimacy.userConsentEnabled,
        )
    raise TypeError("Unsupported completion request")


def prepare_job(body: CompletionRequest, lore: LoreCatalogue | None = None) -> CompletionJob:
    endpoint = ENDPOINTS_BY_REQUEST[type(body)]
    policy = POLICIES[endpoint.scenario]
    context = prepare_context(body, lore)
    quote = trim_text(body.messages[-1].content) if isinstance(body, InteractionChatRequest) else None
    effect_policy = (
        context.interaction.effect_policy
        if isinstance(context, (InteractionChatContext, InteractionTouchContext))
        else None
    )
    return CompletionJob(
        request_id=body.requestId,
        inference=InferenceRequest(policy.build_blocks(context), policy.max_output_tokens, policy.context_window),
        timeout=policy.timeout,
        encoder=WireReplyEncoder(body.requestId, policy, endpoint.response_type, quote, effect_policy),
    )
