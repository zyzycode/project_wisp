"""Full payload comparison for CTX-I10 across every configured model profile."""

import asyncio
import json
from dataclasses import asdict
from pathlib import Path

import httpx
import pytest
from tests.completion.projection_archive import assert_projected_input, projected_factual_messages
from tests.helpers import CONTRACT_FIXTURES
from wisp_backend.api.dispatch import prepare_job
from wisp_backend.api.endpoints import ENDPOINTS
from wisp_backend.completion.context import render_messages, response_schema_for, select_context
from wisp_backend.config.settings import AssistantSettings
from wisp_backend.prompt_inspection.report import PROVIDERS, digest, encoded
from wisp_backend.prompt_inspection.scenes import load_scene
from wisp_backend.providers.context_budget import CONTEXT_WINDOWS

ARTIFACT = Path(__file__).parents[1] / "fixtures/prompt_inspection/issue144_comparison.json"
VARIANTS = (
    "chat_eligible",
    "chat_suppressed",
    "touch_eligible",
    "touch_suppressed",
    "events",
    "observation",
    "summary",
    "beverage_opt_in",
    "beverage_recall",
    "beverage_drop",
    "long_context",
)


def cases() -> list[dict]:
    return [
        dict(provider=p, model=m, locale=locale, variant=v)
        for p, m in CONTEXT_WINDOWS
        for locale in ("ru", "en")
        for v in VARIANTS
    ]


async def capture(case: dict, allowance: int | None = None) -> dict:
    variant, locale = case["variant"], case["locale"]
    if variant in ("observation", "summary"):
        name = "observation/request.valid.json" if variant == "observation" else "summary/request.summary.json"
        body = json.loads((CONTRACT_FIXTURES / "desktop-backend-v1" / name).read_bytes())
        body["locale"] = locale
        route, lore = f"/v1/{variant}", None
    else:
        scene = (
            "long_context"
            if variant == "long_context"
            else ("touch" if variant.startswith("touch_") else "event_caught" if variant == "events" else "praise")
        )
        route, body, lore, _ = load_scene(scene, locale)
    if variant.endswith(("eligible", "suppressed")):
        body["effectPolicy"] = variant.rsplit("_", 1)[1]
    if variant.startswith("beverage_"):
        body["beveragePreference"] = (
            {"allowProposal": False, "current": {"value": "tea", "validity": "confirmed"}}
            if variant == "beverage_recall"
            else {"allowProposal": True}
        )
    job = prepare_job(ENDPOINTS[route].request_type.model_validate(body), lore)
    settings = AssistantSettings(provider=case["provider"], model=case["model"])
    cap = min(settings.max_output_tokens, job.inference.max_output_tokens)
    window = min(CONTEXT_WINDOWS[settings.provider, settings.model], job.inference.context_window or 16384)

    def deny(request: httpx.Request) -> httpx.Response:
        pytest.fail("Offline comparison attempted HTTP")

    async with httpx.AsyncClient(transport=httpx.MockTransport(deny), trust_env=False) as client:
        adapter = PROVIDERS[settings.provider](client, settings)

        def payload(blocks):
            return adapter.request(render_messages(blocks), settings, cap, response_schema=response_schema_for(blocks))[
                1
            ]

        def size(blocks):
            return adapter.estimate_payload(payload(blocks), len(render_messages(blocks)))

        if allowance is None:
            allowance = (
                size(tuple(b for b in job.inference.blocks if b.required))
                if variant == "beverage_drop"
                else window - cap
            )
        trace = []
        selected = select_context(job.inference.blocks, allowance, size, trace=trace)
        messages, outgoing = render_messages(selected), payload(selected)
        return {
            "input": body,
            "input_sha256": digest(body),
            "settings": settings.model_dump(),
            "budget": {"window": window, "reserve": cap, "allowance": allowance},
            "selected_estimate": size(selected),
            "selected_keys": [b.key for b in selected],
            "blocks": [
                {
                    "key": b.key,
                    "source": b.source,
                    "required": b.required,
                    "priority": b.priority,
                    "order": b.order,
                    "messages": render_messages((b,)),
                }
                for b in job.inference.blocks
            ],
            "trace": [asdict(item) for item in trace],
            "messages": messages,
            "payload": outgoing,
            "payload_bytes": len(encoded(outgoing)),
            "messages_sha256": digest(messages),
            "payload_sha256": digest(outgoing),
            "system_utf16": sum(len(m["content"].encode("utf-16-le")) // 2 for m in messages if m["role"] == "system"),
        }


def test_all_profiles_keep_inputs_facts_settings_and_budget_with_generated_reply_shapes() -> None:
    from tests.completion.test_prompt_deduplication import factual_messages, thaw

    archive = json.loads(ARTIFACT.read_bytes())
    assert archive["provider_calls"] == 0 and archive["synthetic"] is True
    rows = thaw(archive["rows"], archive["text_pool"])
    assert [row["case"] for row in rows] == cases()

    async def run():
        for row in rows:
            before, archived = row["before"], row["after"]
            current = await capture(row["case"], before["budget"]["allowance"])
            for result in (archived, current):
                if result is current:
                    assert_projected_input(result["input"], before["input_sha256"], before["blocks"])
                else:
                    assert result["input_sha256"] == before["input_sha256"]
                assert result["settings"] == before["settings"] and result["budget"] == before["budget"]
                assert result["selected_estimate"] <= result["budget"]["allowance"]
                old = {b["key"]: b for b in before["blocks"]}
                assert old.keys() == {b["key"] for b in result["blocks"]}
                for block in result["blocks"]:
                    original = old[block["key"]]
                    expected = projected_factual_messages(original) if result is current else factual_messages(original)
                    assert factual_messages(block) == expected
                    for key in ("source", "required", "priority", "order"):
                        assert block[key] == old[block["key"]][key]
            for saved in (before, archived):
                assert digest(saved["messages"]) == saved["messages_sha256"]
                assert digest(saved["payload"]) == saved["payload_sha256"]
                assert len(encoded(saved["payload"])) == saved["payload_bytes"]

    asyncio.run(run())
