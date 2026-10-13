"""Select prompt and reply rules without owning request execution or HTTP state."""
from typing import TypeAlias

from wisp_backend.contracts import ReplyContext
from wisp_backend.events_schemas import EventModelReply, EventRequest
from wisp_backend.memory_schemas import MemoryModelReply, MemoryRequest
from wisp_backend.prompts import build_messages
from wisp_backend.schemas import ChatRequest, ModelReply, trim_text
from wisp_backend.touch_prompts import build_touch_messages
from wisp_backend.touch_schemas import TouchModelReply, TouchRequest

CompletionRequest: TypeAlias = ChatRequest | TouchRequest | MemoryRequest | EventRequest
CompletionReply: TypeAlias = ModelReply | TouchModelReply | MemoryModelReply | EventModelReply


def reply_context(body: CompletionRequest) -> ReplyContext:
    if isinstance(body, TouchRequest):
        return ReplyContext(mode="touch")
    if isinstance(body, EventRequest):
        return ReplyContext(version=3, mode="event")
    if isinstance(body, MemoryRequest):
        return ReplyContext(version=body.version, evidence_quote=trim_text(body.messages[-1].content))
    return ReplyContext()


def prepare_completion(body: CompletionRequest) -> tuple[list[dict[str, str]], ReplyContext | None]:
    """Preserve v1's default provider call and explicit contexts for newer modes."""
    if isinstance(body, TouchRequest):
        return build_touch_messages(body), reply_context(body)
    context = reply_context(body) if isinstance(body, (EventRequest, MemoryRequest)) else None
    return build_messages(body), context


def model_reply_type(context: ReplyContext) -> type[CompletionReply]:
    """Use strict text-only schemas before any chat hint sanitization can occur."""
    if context.mode == "event":
        return EventModelReply
    if context.mode == "touch":
        return TouchModelReply
    if context.version in (2, 3):
        return MemoryModelReply
    return ModelReply
