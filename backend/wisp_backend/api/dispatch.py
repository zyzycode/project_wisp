"""Translate validated wire input into a transport-independent execution job."""

from typing import TypeAlias

from wisp_backend.api.endpoints import ENDPOINTS_BY_REQUEST
from wisp_backend.api.responses import WireReplyEncoder
from wisp_backend.api.schemas.chat import ChatRequest
from wisp_backend.api.schemas.events import EventAwareChatRequest, EventRequest
from wisp_backend.api.schemas.memory import MemoryRequest
from wisp_backend.api.schemas.touch import TouchRequest
from wisp_backend.completion.contracts import CompletionJob, InferenceRequest
from wisp_backend.completion.policies import POLICIES
from wisp_backend.completion.prompts.context import PromptContext
from wisp_backend.validation import trim_text


CompletionRequest: TypeAlias = ChatRequest | TouchRequest | MemoryRequest | EventRequest


def prepare_job(body: CompletionRequest) -> CompletionJob:
    endpoint = ENDPOINTS_BY_REQUEST[type(body)]
    policy = POLICIES[endpoint.scenario]
    context = PromptContext(
        locale=body.locale,
        character=body.character.model_dump(exclude_unset=True),
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
        inference=InferenceRequest(policy.build_messages(context), policy.max_output_tokens),
        timeout=policy.timeout,
        encoder=WireReplyEncoder(body.requestId, body.version, policy, endpoint.response_type, quote),
    )
