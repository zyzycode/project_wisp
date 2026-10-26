"""Expanded bounded dialogue reaches both provider transports without a three-pair slice."""

import json

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from tests.helpers import CONTRACT_FIXTURES, gemini_completion
from wisp_backend.api.schemas.interaction import InteractionChatRequest


def messages(pairs: int = 10) -> list[dict[str, str]]:
    return [
        turn
        for index in range(pairs)
        for turn in (
            {"role": "user", "content": f"Earlier question {index}?"},
            {"role": "assistant", "content": f"We discussed plan {index}."},
        )
    ] + [{"role": "user", "content": "Return to the first question."}]


def test_message_count_and_history_utf16_are_independently_bounded(body: dict) -> None:
    body["messages"] = messages()
    InteractionChatRequest.model_validate(body)
    body["messages"] = messages(11)
    with pytest.raises(ValidationError):
        InteractionChatRequest.model_validate(body)
    body["messages"] = [
        turn
        for _ in range(4)
        for turn in ({"role": "user", "content": "😀" * 100}, {"role": "assistant", "content": "😀" * 900})
    ] + [{"role": "user", "content": "😀" * 120}]
    # History 8000 and current user 240 are separate inclusive UTF-16 budgets.
    InteractionChatRequest.model_validate(body)
    body["messages"][1]["content"] += "x"
    with pytest.raises(ValidationError):
        InteractionChatRequest.model_validate(body)


@pytest.mark.parametrize("provider", ["openai", "gemini"])
def test_ten_pairs_and_early_reference_reach_generation_and_replay_once(
    app_factory, body: dict, chat_completion, provider: str
) -> None:
    body["messages"] = messages()
    generation = []
    counts = []

    def handler(request: httpx.Request) -> httpx.Response:
        generation.append(json.loads(request.content))
        return httpx.Response(200, json=gemini_completion() if provider == "gemini" else chat_completion())

    def count(request: httpx.Request) -> httpx.Response:
        counts.append(json.loads(request.content))
        return httpx.Response(200, json={"totalTokens": 1000})

    with TestClient(
        app_factory(handler, count_handler=count, assistants={"default": {"provider": provider}})
    ) as client:
        response = client.post("/v1/chat", json=body)
        assert response.status_code == 200
        assert client.post("/v1/chat", json=body).content == response.content
    assert len(generation) == 1
    if provider == "openai":
        projected = generation[0]["messages"]
        history = projected[-21:]
    else:
        assert len(counts) == 1
        assert counts[0]["generateContentRequest"] == {
            "model": "models/gemini-3.5-flash-lite",
            **generation[0],
        }
        contents = generation[0]["contents"]
        assert sum(item["role"] == "model" for item in contents) == 10
        history = [
            {"role": "assistant" if item["role"] == "model" else "user", "content": part["text"]}
            for item in contents
            for part in item["parts"]
        ][-21:]
    assert history == body["messages"]


@pytest.mark.parametrize("violation", ["count", "history_utf16", "even", "role", "bytes"])
def test_invalid_expanded_history_never_dispatches_provider(client_factory, body: dict, violation: str) -> None:
    body["messages"] = messages(11 if violation == "count" else 10)
    if violation == "history_utf16":
        for index in range(1, 21, 2):
            body["messages"][index]["content"] = "x" * 900
    elif violation == "even":
        body["messages"].pop()
    elif violation == "role":
        body["messages"][8]["role"] = "assistant"
    raw = json.dumps(body).encode()
    if violation == "bytes":
        raw += b" " * (32769 - len(raw))
    with client_factory(lambda _: pytest.fail("Invalid history reached provider")) as client:
        response = client.post("/v1/chat", content=raw, headers={"content-type": "application/json"})
    assert response.status_code == (413 if violation == "bytes" else 400)
    assert response.json()["error"]["code"] == ("payload_too_large" if violation == "bytes" else "invalid_request")


@pytest.mark.parametrize("overflow", [False, True])
def test_gemini_expanded_selection_is_bounded_and_keeps_whole_suffix(body: dict, overflow: bool) -> None:
    import asyncio

    from wisp_backend.api.dispatch import prepare_job
    from wisp_backend.config.settings import AssistantSettings
    from wisp_backend.providers.gemini import GeminiProvider

    body["messages"] = messages()
    job = prepare_job(InteractionChatRequest.model_validate(body))
    calls = []
    generation = []

    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        calls.append(request.url.path)
        if request.url.path.endswith(":countTokens"):
            contents = payload["generateContentRequest"]["contents"]
            pairs = sum(item["role"] == "model" for item in contents)
            return httpx.Response(200, json={"totalTokens": 20000 if overflow else 7000 + 1000 * pairs})
        generation.append(payload)
        return httpx.Response(200, json=gemini_completion())

    async def run() -> None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url="https://mock.invalid") as client:
            result = await GeminiProvider(client, AssistantSettings(provider="gemini")).complete(job.inference, 10)
        assert result.error == ("upstream_unavailable" if overflow else None)
        if overflow:
            assert result.usage is not None and result.usage.total == 0

    asyncio.run(run())
    optional = sum(not block.required for block in job.inference.blocks)
    assert sum(path.endswith(":countTokens") for path in calls) <= optional + 2
    assert len(generation) == (0 if overflow else 1)
    if generation:
        contents = generation[0]["contents"]
        assert sum(item["role"] == "model" for item in contents) == 5
        projected = [
            {"role": "assistant" if item["role"] == "model" else "user", "content": part["text"]}
            for item in contents
            for part in item["parts"]
        ]
        assert projected[-11:] == body["messages"][-11:]
        assert all(turn not in projected for turn in body["messages"][:10])


def test_shared_expanded_history_contract_fixtures() -> None:
    root = CONTRACT_FIXTURES / "desktop-backend-v1/history"
    body = json.loads((root / "request.valid.json").read_text())
    assert len(InteractionChatRequest.model_validate(body).messages) == 21
    for case in json.loads((root / "invalid.json").read_text()):
        with pytest.raises(ValidationError):
            InteractionChatRequest.model_validate({**body, "messages": case["messages"]})
