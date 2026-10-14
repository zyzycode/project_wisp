"""Test-only policy overrides without changing production defaults."""

from dataclasses import replace
import json
from pathlib import Path

import httpx
import pytest

from wisp_backend.completion.policies import POLICIES, Scenario


def set_event_timeout(monkeypatch: pytest.MonkeyPatch, timeout: float) -> None:
    monkeypatch.setitem(POLICIES, Scenario.EVENT, replace(POLICIES[Scenario.EVENT], timeout=timeout))


CONTRACT_FIXTURES = Path(__file__).resolve().parents[2] / "docs/contracts/fixtures"


def touch_body(body, variant="stroke"):
    return {key: value for key, value in body.items() if key != "messages"} | {
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
    return {"candidates": [{"finishReason": "STOP", "content": {"role": "model", "parts": [
        {"text": json.dumps(reply if reply is not None else {"text": "Hello"})}]}}],
        "usageMetadata": usage if usage is not None else {
            "promptTokenCount": 5, "candidatesTokenCount": 2, "thoughtsTokenCount": 3, "totalTokenCount": 10}}
