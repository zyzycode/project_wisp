"""Shared bounded transport and semantic validation for inference adapters."""
from abc import ABC, abstractmethod
from typing import Any

import httpx

from wisp_backend.config import AssistantSettings
from wisp_backend.contracts import ProviderResult, ReplyContext, Usage
from wisp_backend.events_schemas import EventModelReply
from wisp_backend.json_codec import decode_json
from wisp_backend.memory_schemas import MemoryModelReply
from wisp_backend.schemas import ModelReply
from wisp_backend.touch_schemas import TouchModelReply

MAX_UPSTREAM_BYTES = 256 * 1024


class HTTPProvider(ABC):
    def __init__(self, client: httpx.AsyncClient) -> None:
        self.client = client

    @abstractmethod
    def request(self, messages: list[dict[str, str]], settings: AssistantSettings,
                output_cap: int) -> tuple[str, dict[str, Any]]: ...

    @abstractmethod
    def usage(self, data: dict[str, Any]) -> Usage | None: ...

    @abstractmethod
    def text(self, data: dict[str, Any]) -> str: ...

    async def complete(self, messages: list[dict[str, str]], settings: AssistantSettings,
                       timeout: float, reply_context: ReplyContext = ReplyContext()) -> ProviderResult:
        output_cap = min(settings.max_output_tokens, 1024) if reply_context.mode == "event" else settings.max_output_tokens
        path, payload = self.request(messages, settings, output_cap)
        usage = None
        try:
            budget = httpx.Timeout(timeout, connect=min(3, timeout, self.client.timeout.connect),
                                   pool=min(3, timeout, self.client.timeout.pool))
            async with self.client.stream("POST", path, json=payload, timeout=budget) as response:
                if not response.is_success:
                    return ProviderResult(error="upstream_unavailable")
                content = bytearray()
                async for chunk in response.aiter_bytes():
                    if len(content) + len(chunk) > MAX_UPSTREAM_BYTES:
                        return ProviderResult(error="invalid_model_response")
                    content.extend(chunk)
                try:
                    data = decode_json(content.decode("utf-8"))
                    if not isinstance(data, dict):
                        raise ValueError("Invalid provider envelope")
                    usage = self.usage(data)
                    proposed = self.text(data)
                    model_type = (EventModelReply if reply_context.mode == "event" else
                                  TouchModelReply if reply_context.mode == "touch" else
                                  MemoryModelReply if reply_context.version in (2, 3) else ModelReply)
                    reply = model_type.model_validate(decode_json(proposed),
                                                     context={"evidence_quote": reply_context.evidence_quote})
                    return ProviderResult(reply, usage)
                except (ValueError, KeyError, IndexError, TypeError, RecursionError):
                    return ProviderResult(usage=usage, error="invalid_model_response")
        except httpx.TimeoutException:
            return ProviderResult(error="upstream_timeout")
        except httpx.RequestError:
            return ProviderResult(error="upstream_unavailable")
