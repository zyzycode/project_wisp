import asyncio
import json
from collections.abc import Callable
from types import SimpleNamespace

import httpx
import pytest
from fastapi.testclient import TestClient
from tests.helpers import CONTRACT_FIXTURES, touch_body
from wisp_backend.completion import service as service_module


def test_shared_touch_fixture(client_factory, chat_completion):
    fixture = CONTRACT_FIXTURES / "desktop-backend-v1/request.touch.json"
    with client_factory(lambda _: httpx.Response(200, json=chat_completion({"text": "Щекотно!"}))) as client:
        response = client.post("/v1/touch", json=json.loads(fixture.read_text(encoding="utf-8")))
        assert response.status_code == 200


@pytest.mark.parametrize("variant", ["touch"])
def test_touch_prompt_and_text_only_response(client_factory, body, chat_completion, variant):
    calls = []

    def upstream(request):
        calls.append(request)
        messages = json.loads(request.content)["messages"]
        assert sum(item["role"] != "system" for item in messages) == 3
        assert "text:text<=240" in messages[0]["content"] and "UTF-16" in messages[0]["content"]
        assert '"variant":"touch"' in messages[-1]["content"]
        character = next(
            item["content"]
            for item in messages
            if item["content"].startswith("[Character card & current factual state]")
        )
        assert body["messages"][-1]["content"] not in character
        return httpx.Response(
            200,
            json=chat_completion(
                {
                    "text": "Хи-хи, щекотно!",
                    "appraisal": {"category": "neutral", "intensity": "low", "confidence": "clear"},
                }
            ),
        )

    with client_factory(upstream) as client:
        response = client.post("/v1/touch", json=touch_body(body, variant))
        assert response.status_code == 200
        assert response.json() == {
            "requestId": body["requestId"],
            "text": "Хи-хи, щекотно!",
            "appraisal": {"category": "neutral", "intensity": "low", "confidence": "clear"},
        }
        assert len(calls) == 1


@pytest.mark.parametrize(
    "event",
    [
        {"type": "user_touch", "variant": "unknown"},
        {"type": "user_touch", "variant": "stroke", "prompt": "override"},
        {"type": "user_touch"},
        {"type": "user_message", "variant": "touch"},
    ],
)
def test_invalid_touch_never_calls_provider(client_factory, body, event):
    with client_factory(lambda _: pytest.fail("No provider call expected")) as client:
        response = client.post("/v1/touch", json=touch_body(body) | {"event": event})
        assert response.status_code == 400
        assert response.json()["requestId"] == body["requestId"]


@pytest.mark.parametrize(
    "reply", [{"text": "x" * 241}, {"text": ""}, {"text": "OK", "decision": {"behavior": "respond", "confidence": 1}}]
)
def test_touch_rejects_invalid_model_reply(client_factory, body, chat_completion, reply):
    with client_factory(lambda _: httpx.Response(200, json=chat_completion(reply))) as client:
        response = client.post("/v1/touch", json=touch_body(body))
        assert response.status_code == 502
        assert response.json()["error"]["code"] == "invalid_model_response"


@pytest.mark.parametrize("status", [401, 503])
def test_touch_upstream_failure_is_safe(client_factory, body, status):
    with client_factory(lambda _: httpx.Response(status, text="private diagnostic")) as client:
        response = client.post("/v1/touch", json=touch_body(body))
        assert response.status_code == 503
        assert "private" not in response.text


def test_touch_boundary_rejects_oversized_body(client_factory):
    with client_factory(lambda _: pytest.fail("No provider call expected")) as client:
        response = client.post("/v1/touch", content=b" " * 32769, headers={"Content-Type": "application/json"})
        assert response.status_code == 413


def test_touch_deadline_cancels_provider(app_factory: Callable, body: dict, monkeypatch: pytest.MonkeyPatch) -> None:
    cancelled = []
    entered = asyncio.Event()

    class SlowProvider:
        async def complete(self, request: object, timeout: float) -> None:
            entered.set()
            try:
                await asyncio.sleep(10)
            finally:
                cancelled.append(True)

    async def expire_provider_wait(tasks: set, *, timeout: float | None = None, **kwargs: object) -> tuple[set, set]:
        if any(task.get_coro().__qualname__ == SlowProvider.complete.__qualname__ for task in tasks):
            # Expire generation only after it starts; durable admission has its own deadline tests.
            await asyncio.wait_for(entered.wait(), 2)
            assert timeout is not None and 0 < timeout <= 10
            return set(), set(tasks)
        return await asyncio.wait(tasks, timeout=timeout, **kwargs)

    monkeypatch.setattr(service_module, "asyncio", SimpleNamespace(**{**vars(asyncio), "wait": expire_provider_wait}))
    app = app_factory(lambda _: pytest.fail("No HTTP call expected"))
    with TestClient(app) as client:
        service = app.state.completion_service
        service.provider = SlowProvider()
        response = client.post("/v1/touch", json=touch_body(body))
        assert response.status_code == 504
    # Lifespan shutdown drains independently scheduled cancellation/settlement.
    assert entered.is_set() and cancelled == [True]
