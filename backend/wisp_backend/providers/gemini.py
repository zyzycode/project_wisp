"""Native Gemini generateContent; credentials and wire translation stay server-side."""

from typing import Any

import httpx

from wisp_backend.accounting.contracts import Usage
from wisp_backend.completion.context import ContextBlock, render_messages, select_context_async
from wisp_backend.completion.contracts import InferenceRequest
from wisp_backend.errors import ServiceError
from wisp_backend.json_codec import decode_json
from wisp_backend.config.settings import AssistantSettings
from wisp_backend.providers.http_provider import HTTPProvider


class GeminiProvider(HTTPProvider):
    def request(self, messages: list[dict[str, str]], settings: AssistantSettings,
                output_cap: int) -> tuple[str, dict[str, Any]]:
        generation: dict[str, Any] = {
            "responseMimeType": "application/json", "maxOutputTokens": output_cap, "candidateCount": 1,
            "thinkingConfig": {"thinkingLevel": settings.effective_thinking_level},
        }
        if settings.temperature is not None:
            generation["temperature"] = settings.temperature
        contents: list[dict[str, Any]] = []
        for message in messages:
            if message["role"] == "system":
                continue
            role = "model" if message["role"] == "assistant" else "user"
            part = {"text": message["content"]}
            if contents and contents[-1]["role"] == role:
                contents[-1]["parts"].append(part)
            else:
                contents.append({"role": role, "parts": [part]})
        payload: dict[str, Any] = {
            "systemInstruction": {"parts": [{"text": message["content"]} for message in messages
                                             if message["role"] == "system"]},
            "contents": contents,
            "generationConfig": generation,
        }
        return f"models/{settings.model}:generateContent", payload

    async def select_blocks(self, request: InferenceRequest, cap: int, allowance: int,
                            deadline: float) -> tuple[ContextBlock, ...]:
        async def count(blocks: tuple[ContextBlock, ...]) -> int:
            _, payload = self.request(render_messages(blocks), self.settings, cap)
            return await self.count_tokens(payload, deadline)
        return await select_context_async(request.blocks, allowance, count)

    async def count_tokens(self, payload: dict[str, Any], deadline: float) -> int:
        """Official model preflight of the exact generateContent payload.

        This is not billing usage: generation usageMetadata remains authoritative.
        Nothing is cached beyond one context selection or persisted in the ledger.
        """
        remaining = self.remaining(deadline)
        timeout = httpx.Timeout(remaining, connect=min(3, remaining, self.client.timeout.connect),
                                pool=min(3, remaining, self.client.timeout.pool))
        model = f"models/{self.settings.model}"
        body = {"generateContentRequest": {"model": model, **payload}}
        try:
            async with self.client.stream("POST", model + ":countTokens", json=body, timeout=timeout) as response:
                if not response.is_success:
                    raise ServiceError("upstream_unavailable")
                content = bytearray()
                async for chunk in response.aiter_bytes():
                    self.remaining(deadline)
                    if len(content) + len(chunk) > 16 * 1024:
                        raise ServiceError("upstream_unavailable")
                    content.extend(chunk)
            self.remaining(deadline)
            data = decode_json(content.decode("utf-8"))
            count = data.get("totalTokens") if isinstance(data, dict) else None
            if type(count) is not int or count < 0:
                raise ServiceError("upstream_unavailable")
            return count
        except httpx.TimeoutException:
            raise ServiceError("upstream_timeout") from None
        except (httpx.RequestError, ValueError, UnicodeError, RecursionError):
            raise ServiceError("upstream_unavailable") from None

    def usage(self, data: dict[str, Any]) -> Usage | None:
        metadata = data.get("usageMetadata")
        if not isinstance(metadata, dict):
            return None
        parts = [metadata.get("promptTokenCount"), metadata.get("candidatesTokenCount"),
                 metadata.get("thoughtsTokenCount", 0), metadata.get("totalTokenCount")]
        if any(type(part) is not int or part < 0 for part in parts):
            return None
        prompt, candidates, thoughts, total = parts
        return Usage.validated(prompt, candidates + thoughts, total)

    def text(self, data: dict[str, Any]) -> str:
        candidates = data["candidates"]
        if not isinstance(candidates, list) or len(candidates) != 1:
            raise ValueError("Invalid candidates")
        candidate = candidates[0]
        if candidate["finishReason"] != "STOP":
            raise ValueError("Incomplete or blocked output")
        parts = candidate["content"]["parts"]
        if not isinstance(parts, list) or not parts:
            raise ValueError("Invalid content")
        texts: list[str] = []
        for part in parts:
            if not isinstance(part, dict):
                raise ValueError("Invalid part")
            if part.get("thought") is True:
                continue
            if not isinstance(part.get("text"), str):
                raise ValueError("Non-text output")
            texts.append(part["text"])
        return "".join(texts)
