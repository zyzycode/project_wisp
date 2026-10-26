"""Empirical local budgeting, including adversarial inputs; never token proofs."""

import asyncio
import json
from dataclasses import replace

import httpx
import pytest
from wisp_backend.accounting.contracts import Usage
from wisp_backend.completion.context import ContextBlock, ContextMessage
from wisp_backend.completion.contracts import InferenceRequest
from wisp_backend.config.settings import AssistantSettings
from wisp_backend.providers.context_budget import estimate_input, estimate_openai_input
from wisp_backend.providers.openai import OpenAIProvider


def payload(text: str, model: str = "gpt-6-sol") -> dict:
    return {"model": model, "reasoning_effort": "none", "messages": [{"role": "user", "content": text}]}


@pytest.mark.parametrize(
    "text", ["A friendly ordinary English sentence. " * 100, "Привет, это обычный разговор. " * 100]
)
def test_sol_prose_frees_budget_without_changing_payload(text: str) -> None:
    body = payload(text)
    original = json.dumps(body, ensure_ascii=False)
    assert 0 < estimate_openai_input(body, 1) < estimate_input(body, 1)
    assert json.dumps(body, ensure_ascii=False) == original


@pytest.mark.parametrize("model,effort", [("gpt-4.1-mini", "none"), ("gpt-6-astra", "low"), ("gpt-6-sol", "low")])
def test_unmeasured_models_and_reasoning_modes_keep_byte_fallback(model: str, effort: str) -> None:
    body = {**payload("ordinary words " * 100, model), "reasoning_effort": effort}
    assert estimate_openai_input(body, 1) == estimate_input(body, 1)


@pytest.mark.parametrize("text", ["", '😀漢字é\n"\\' * 300, "x" * 20000, "1234_./:-" * 2000])
def test_unsupported_unicode_and_long_identifier_runs_retain_byte_fallback(text: str) -> None:
    body = payload(text)
    estimate = estimate_openai_input(body, 1)
    assert estimate > 0
    assert estimate <= estimate_input(body, 1)
    # No arbitrary Unicode/identifier discount: their UTF-8 bytes remain charged.
    assert estimate >= len(text.encode("utf-8")) + 256 + 64


def test_short_random_ascii_runs_are_an_explicit_uncertainty_not_a_token_bound() -> None:
    body = payload("qzvxwplm qjqwzv fFjQvZ 82_uuid-7cAa")
    assert estimate_openai_input(body, 1) < estimate_input(body, 1)
    assert estimate_openai_input(body, 2) - estimate_openai_input(body, 1) == 64


def test_provider_uses_the_same_estimate_at_equality_and_rejects_overflow_before_http() -> None:
    required = ContextBlock(
        "required", "server_instructions", True, 100, 0, (ContextMessage("system", "Привет hello"),)
    )
    request = InferenceRequest((required,), max_output_tokens=1024)
    calls = []

    def handler(http_request: httpx.Request) -> httpx.Response:
        calls.append(json.loads(http_request.content))
        return httpx.Response(
            200, json={"choices": [{"finish_reason": "stop", "message": {"content": '{"text":"ok"}'}}]}
        )

    async def run() -> None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url="https://test/") as client:
            provider = OpenAIProvider(client, AssistantSettings(provider="openai", model="gpt-6-sol"))
            body = provider.request([{"role": "system", "content": "Привет hello"}], provider.settings, 1024)[1]
            required_size = estimate_openai_input(body, 1)
            exact = replace(request, context_window=required_size + 1024)
            assert (await provider.complete(exact, 1)).text == '{"text":"ok"}'
            assert calls[0] == body
            overflow = await provider.complete(replace(exact, context_window=exact.context_window - 1), 1)
            assert overflow.error == "upstream_unavailable" and overflow.usage == Usage(0, 0, 0)
            assert len(calls) == 1

    asyncio.run(run())


def test_conditional_beverage_schema_is_part_of_the_actual_final_payload_estimate() -> None:
    from wisp_backend.api.dispatch import prepare_job
    from wisp_backend.api.schemas.interaction import InteractionChatRequest
    from wisp_backend.completion.context import render_messages, response_schema_for
    from wisp_backend.prompt_inspection.scenes import load_scene

    async def run() -> None:
        route, body, lore, _ = load_scene("greeting_low_trust", "ru")
        assert route == "/v1/chat"
        body = {**body, "beveragePreference": {"allowProposal": True}}
        job = prepare_job(InteractionChatRequest.model_validate(body), lore)
        sent = []

        def handler(request: httpx.Request) -> httpx.Response:
            sent.append(json.loads(request.content))
            return httpx.Response(
                200, json={"choices": [{"finish_reason": "stop", "message": {"content": '{"text":"ok"}'}}]}
            )

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url="https://test/") as client:
            provider = OpenAIProvider(client, AssistantSettings(provider="openai", model="gpt-6-sol"))
            deadline = asyncio.get_running_loop().time() + 1
            selected = await provider.select_blocks(job.inference, 4096, 16384 - 4096, deadline)
            messages = render_messages(selected)
            schema = response_schema_for(selected)
            assert schema is not None
            actual = provider.request(messages, provider.settings, 4096, response_schema=schema)[1]
            assert actual["response_format"]["type"] == "json_schema"
            assert provider.estimate_payload(actual, len(messages)) == estimate_openai_input(actual, len(messages))
            plain = provider.request(messages, provider.settings, 4096)[1]
            assert provider.estimate_payload(actual, len(messages)) > provider.estimate_payload(plain, len(messages))
            assert provider.estimate_payload(actual, len(messages)) <= 16384 - 4096
            result = await provider.complete(job.inference, 1)
            assert result.error is None and sent == [actual]

    asyncio.run(run())


@pytest.mark.parametrize("finish", ["stop", "length"])
def test_long_structured_output_preserves_chat_reserve_and_known_usage(finish: str) -> None:
    answer = json.dumps(
        {
            "text": "я" * 2000,
            "appraisal": {"category": "neutral", "intensity": "low", "confidence": "clear"},
            "memoryCandidates": [{"key": "user.favorite_topic", "value": "чай", "evidenceQuote": "я" * 240}] * 3,
        },
        ensure_ascii=False,
    )

    def handler(request: httpx.Request) -> httpx.Response:
        assert json.loads(request.content)["max_completion_tokens"] == 4096
        return httpx.Response(
            200,
            json={
                "choices": [{"finish_reason": finish, "message": {"content": answer}}],
                "usage": {"prompt_tokens": 100, "completion_tokens": 3000, "total_tokens": 3100},
            },
        )

    async def run() -> None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url="https://test/") as client:
            provider = OpenAIProvider(client, AssistantSettings(provider="openai", model="gpt-6-sol"))
            result = await provider.complete(InferenceRequest((), max_output_tokens=4096), 1)
            assert result.usage == Usage(100, 3000, 3100)
            if finish == "stop":
                assert result.text == answer and result.error is None
            else:
                assert result.text is None and result.error == "invalid_model_response"

    asyncio.run(run())
