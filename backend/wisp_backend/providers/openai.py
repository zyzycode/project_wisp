"""OpenAI text Chat Completions adapter; no stored completions or tools."""

from typing import Any

from wisp_backend.accounting.contracts import Usage
from wisp_backend.completion.context import StructuredReplySchema
from wisp_backend.config.settings import AssistantSettings
from wisp_backend.providers.context_budget import estimate_openai_input, openai_estimate_method
from wisp_backend.providers.http_provider import HTTPProvider


class OpenAIProvider(HTTPProvider):
    @property
    def estimate_method(self) -> str:
        return openai_estimate_method(self.settings.model, "none" if self.settings.model == "gpt-6-sol" else None)

    def estimate_payload(self, payload: dict[str, Any], message_count: int) -> int:
        return estimate_openai_input(payload, message_count)

    def request(
        self,
        messages: list[dict[str, str]],
        settings: AssistantSettings,
        output_cap: int,
        *,
        response_schema: StructuredReplySchema | None = None,
    ) -> tuple[str, dict[str, Any]]:
        payload: dict[str, Any] = {
            "model": settings.model,
            "messages": messages,
            "stream": False,
            "store": False,
            "max_completion_tokens": output_cap,
            "response_format": {"type": "json_object"},
        }
        if response_schema is not None:
            payload["response_format"] = {
                "type": "json_schema",
                "json_schema": {"name": "wisp_beverage_reply", "strict": False, "schema": response_schema.document()},
            }
        if settings.model == "gpt-6-astra":
            payload["reasoning_effort"] = "low"
        elif settings.model == "gpt-6-sol":
            payload["reasoning_effort"] = "none"
            if settings.temperature is not None:
                payload["temperature"] = settings.temperature
        elif settings.temperature is not None:
            payload["temperature"] = settings.temperature
        return "chat/completions", payload

    def usage(self, data: dict[str, Any]) -> Usage | None:
        usage = data.get("usage")
        if not isinstance(usage, dict):
            return None
        return Usage.validated(usage.get("prompt_tokens"), usage.get("completion_tokens"), usage.get("total_tokens"))

    def text(self, data: dict[str, Any]) -> str:
        choice = data["choices"][0]
        if choice["finish_reason"] != "stop":
            raise ValueError("Incomplete model output")
        message = choice["message"]
        if message.get("refusal") is not None or message.get("tool_calls"):
            raise ValueError("Unsupported model output")
        proposed = message["content"]
        if not isinstance(proposed, str):
            raise ValueError("Invalid model text")
        return proposed
