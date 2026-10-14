"""Native Gemini generateContent; credentials and wire translation stay server-side."""

from typing import Any

from wisp_backend.accounting.contracts import Usage
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
