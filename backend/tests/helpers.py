"""Test-only policy overrides without changing production defaults."""

import inspect
import json
from collections.abc import Awaitable, Callable
from dataclasses import replace
from pathlib import Path

import httpx
import pytest
from wisp_backend.completion.policies import POLICIES, Scenario
from wisp_backend.providers.context_budget import estimate_input

ProviderHandler = Callable[[httpx.Request], httpx.Response | Awaitable[httpx.Response]]


def provider_transport(generation: ProviderHandler, count: ProviderHandler | None = None) -> httpx.MockTransport:
    """Separate mocked generation from preflight in existing lifecycle tests.

    The default count is deliberately conservative and synthetic, not a model
    tokenizer. Exact-count behavior is tested with explicit count handlers.
    """

    async def handle(request: httpx.Request) -> httpx.Response:
        handler = generation
        if request.url.path.endswith(":countTokens"):
            if count is None:
                payload = json.loads(request.content)["generateContentRequest"]
                payload.pop("model")
                messages = sum(len(item["parts"]) for item in payload["contents"]) + len(
                    payload["systemInstruction"]["parts"]
                )
                return httpx.Response(200, json={"totalTokens": estimate_input(payload, messages)})
            handler = count
        response = handler(request)
        return await response if inspect.isawaitable(response) else response

    return httpx.MockTransport(handle)


def set_event_timeout(monkeypatch: pytest.MonkeyPatch, timeout: float) -> None:
    monkeypatch.setitem(POLICIES, Scenario.EVENT, replace(POLICIES[Scenario.EVENT], timeout=timeout))


CONTRACT_FIXTURES = Path(__file__).resolve().parents[2] / "docs/contracts/fixtures"


def touch_body(body, variant="touch"):
    return {
        key: value
        for key, value in body.items()
        if key not in ("messages", "memory", "summary", "previousInitiative", "previousTouch")
    } | {
        "event": {"type": "user_touch", "variant": variant},
    }


class TrackedStream(httpx.AsyncByteStream):
    def __init__(self, chunks, error=None):
        self.chunks = chunks
        self.closed = False
        self.error = error
        self.read_count = 0

    async def __aiter__(self):
        for chunk in self.chunks:
            self.read_count += 1
            yield chunk
        if self.error:
            raise self.error

    async def aclose(self):
        self.closed = True


class Clock:
    now = 1_800_000_000.0

    def __call__(self):
        return self.now


def gemini_completion(reply=None, usage=None):
    return {
        "candidates": [
            {
                "finishReason": "STOP",
                "content": {
                    "role": "model",
                    "parts": [
                        {
                            "text": json.dumps(
                                reply
                                if reply is not None
                                else {
                                    "text": "Hello",
                                    "appraisal": {"category": "neutral", "intensity": "low", "confidence": "clear"},
                                }
                            )
                        }
                    ],
                },
            }
        ],
        "usageMetadata": (
            usage
            if usage is not None
            else {"promptTokenCount": 5, "candidatesTokenCount": 2, "thoughtsTokenCount": 3, "totalTokenCount": 10}
        ),
    }
