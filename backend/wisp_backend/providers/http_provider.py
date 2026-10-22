"""Bounded provider transport, envelope decoding and usage extraction."""

from abc import ABC, abstractmethod
import asyncio
from typing import Any

import httpx

from wisp_backend.accounting.contracts import Usage
from wisp_backend.completion.contracts import InferenceRequest, ProviderResult
from wisp_backend.completion.context import ContextBlock, ContextOverflow, render_messages, select_context
from wisp_backend.config.settings import AssistantSettings
from wisp_backend.json_codec import decode_json
from wisp_backend.errors import ServiceError
from wisp_backend.providers.context_budget import CONTEXT_WINDOWS, estimate_input


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
        started = asyncio.get_running_loop().time()
        cap = self.settings.max_output_tokens
        if request.max_output_tokens is not None:
            cap = min(cap, request.max_output_tokens)
        deadline = started + timeout
        try:
            self.remaining(deadline)
            window = CONTEXT_WINDOWS[(self.settings.provider, self.settings.model)]
            if request.context_window is not None:
                window = min(window, request.context_window)
            async with asyncio.timeout_at(deadline):
                selected = await self.select_blocks(request, cap, window - cap, deadline)
            self.remaining(deadline)
        except ContextOverflow:
            # Preflight may have used HTTP, but no generation was dispatched.
            return ProviderResult(usage=Usage(0, 0, 0), error="upstream_unavailable")
        except ServiceError as error:
            return ProviderResult(usage=Usage(0, 0, 0), error=error.code)
        except (TimeoutError, asyncio.CancelledError):
            # A cancelled count cannot dispatch generation. Return known zero usage
            # so the service can correct an uncertain reservation after cancellation.
            return ProviderResult(usage=Usage(0, 0, 0), error="upstream_timeout")
        path, payload = self.request(render_messages(selected), self.settings, cap)
        timeout = deadline - asyncio.get_running_loop().time()
        if timeout <= 0:
            return ProviderResult(usage=Usage(0, 0, 0), error="upstream_timeout")
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

    @staticmethod
    def remaining(deadline: float) -> float:
        current = asyncio.current_task()
        if current is not None and current.cancelling():
            raise asyncio.CancelledError
        remaining = deadline - asyncio.get_running_loop().time()
        if remaining <= 0:
            raise ServiceError("upstream_timeout")
        return remaining

    async def select_blocks(self, request: InferenceRequest, cap: int, allowance: int,
                            deadline: float) -> tuple[ContextBlock, ...]:
        """Local selection with a conservative estimate, not exact tokens."""
        def estimate(blocks: tuple[ContextBlock, ...]) -> int:
            self.remaining(deadline)
            messages = render_messages(blocks)
            _, payload = self.request(messages, self.settings, cap)
            return estimate_input(payload, len(messages))
        return select_context(request.blocks, allowance, estimate)

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
