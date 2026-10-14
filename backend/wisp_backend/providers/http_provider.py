"""Bounded provider transport, envelope decoding and usage extraction."""

from abc import ABC, abstractmethod
from typing import Any

import httpx

from wisp_backend.accounting.contracts import Usage
from wisp_backend.completion.contracts import InferenceRequest, ProviderResult
from wisp_backend.config.settings import AssistantSettings
from wisp_backend.json_codec import decode_json


MAX_UPSTREAM_BYTES = 256 * 1024


class HTTPProvider(ABC):
    def __init__(self, client: httpx.AsyncClient, settings: AssistantSettings) -> None:
        self.client = client
        self.settings = settings

    @abstractmethod
    def request(self, messages: list[dict[str, str]], settings: AssistantSettings,
                output_cap: int) -> tuple[str, dict[str, Any]]: ...

    @abstractmethod
    def usage(self, data: dict[str, Any]) -> Usage | None: ...

    @abstractmethod
    def text(self, data: dict[str, Any]) -> str: ...

    async def complete(self, request: InferenceRequest, timeout: float) -> ProviderResult:
        cap = self.settings.max_output_tokens
        if request.max_output_tokens is not None:
            cap = min(cap, request.max_output_tokens)
        path, payload = self.request(request.messages, self.settings, cap)
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
                return self._decode_completion(content)
        except httpx.TimeoutException:
            return ProviderResult(error="upstream_timeout")
        except httpx.RequestError:
            return ProviderResult(error="upstream_unavailable")

    def _decode_completion(self, content: bytearray) -> ProviderResult:
        """Extract accounting before checking model output, preserving paid usage on failure."""
        usage = None
        try:
            data = decode_json(content.decode("utf-8"))
            if not isinstance(data, dict):
                raise ValueError("Invalid provider envelope")
            usage = self.usage(data)
            proposed = self.text(data)
            return ProviderResult(proposed, usage)
        except (ValueError, KeyError, IndexError, TypeError, RecursionError):
            return ProviderResult(usage=usage, error="invalid_model_response")
