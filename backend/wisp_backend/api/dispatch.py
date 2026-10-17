"""Translate validated wire input into a transport-independent execution job."""

from typing import TypeAlias

from wisp_backend.api.endpoints import ENDPOINTS_BY_REQUEST
from wisp_backend.api.responses import WireReplyEncoder
from wisp_backend.api.schemas.interaction import InteractionChatRequest, InteractionTouchRequest
from wisp_backend.api.schemas.chat import ChatRequest
from wisp_backend.api.schemas.events import EventAwareChatRequest, EventRequest
from wisp_backend.api.schemas.memory import MemoryRequest
from wisp_backend.api.schemas.observation import ObservationRequest
from wisp_backend.api.schemas.summary import SummaryRequest, SummaryChatRequest
from wisp_backend.api.schemas.touch import TouchRequest
from wisp_backend.completion.contracts import CompletionJob, InferenceRequest
from wisp_backend.completion.policies import POLICIES
from wisp_backend.completion.prompts.context import PromptContext
from wisp_backend.completion.prompts.lore import LoreCatalogue
from wisp_backend.validation import trim_text


CompletionRequest: TypeAlias = InteractionChatRequest | InteractionTouchRequest | ObservationRequest | SummaryRequest | SummaryChatRequest | ChatRequest | TouchRequest | MemoryRequest | EventRequest


def prepare_job(body: CompletionRequest, lore: LoreCatalogue | None = None) -> CompletionJob:
    endpoint = ENDPOINTS_BY_REQUEST[type(body)]
    policy = POLICIES[endpoint.scenario]
    context = PromptContext(
        locale=body.locale,
        card=body.card.model_dump() if isinstance(body, (InteractionChatRequest, InteractionTouchRequest)) else None,
        effect_policy=body.effectPolicy if isinstance(body, (InteractionChatRequest, InteractionTouchRequest)) else None,
        previous_touch=body.previousTouch.model_dump()
        if isinstance(body, InteractionChatRequest) and body.previousTouch is not None else None,
        observation=body.observation.model_dump() if isinstance(body, ObservationRequest) else None,
        lore=lore,
        character=body.character.model_dump(exclude_unset=True) if not isinstance(body, SummaryRequest) else {},
        summary_pairs=[pair.model_dump() for pair in body.pairs] if isinstance(body, SummaryRequest) else [],
        summary=body.summary.text if isinstance(body, SummaryChatRequest) and body.summary is not None else None,
        messages=[{"role": item.role, "content": trim_text(item.content)} for item in body.messages]
        if isinstance(body, ChatRequest) else [],
        memory=body.memory.model_dump() if isinstance(body, (MemoryRequest, EventRequest)) else None,
        previous_initiative=body.previousInitiative.model_dump()
        if isinstance(body, EventAwareChatRequest) and body.previousInitiative is not None else None,
        event=body.event.model_dump() if isinstance(body, EventRequest) else None,
        touch_variant=body.event.variant if isinstance(body, TouchRequest) else None,
    )
    quote = trim_text(body.messages[-1].content) if isinstance(body, ChatRequest) else None
    return CompletionJob(
        request_id=body.requestId,
        inference=InferenceRequest(policy.build_blocks(context), policy.max_output_tokens, policy.context_window),
        timeout=policy.timeout,
        encoder=WireReplyEncoder(body.requestId, body.version, policy, endpoint.response_type, quote, context.effect_policy),
    )
