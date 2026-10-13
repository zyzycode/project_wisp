"""Groq chat completions adapter for the internal provider port."""
from typing import Any

from wisp_backend.config import AssistantSettings
from wisp_backend.contracts import Usage
from wisp_backend.providers.http_provider import HTTPProvider


class GroqProvider(HTTPProvider):
    def request(self, messages: list[dict[str, str]], settings: AssistantSettings,
                output_cap: int) -> tuple[str, dict[str, Any]]:
        payload: dict[str, Any] = {
            "model": settings.model, "messages": messages, "stream": False,
            "max_completion_tokens": output_cap, "response_format": {"type": "json_object"},
        }
        if settings.temperature is not None:
            payload["temperature"] = settings.temperature
        return "chat/completions", payload

    def usage(self, data: dict[str, Any]) -> Usage | None:
        return Usage.parse(data.get("usage"))

    def text(self, data: dict[str, Any]) -> str:
        choice = data["choices"][0]
        if choice["finish_reason"] != "stop":
            raise ValueError("Incomplete model output")
        proposed = choice["message"]["content"]
        if not isinstance(proposed, str):
            raise ValueError("Invalid model text")
        return proposed
