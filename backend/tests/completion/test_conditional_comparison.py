"""Lossless CTX-I09 comparison at identical inputs, settings and calibrated budgets."""

import asyncio
import json
from dataclasses import asdict
from pathlib import Path

import httpx
import pytest
from tests.completion.test_prompt_deduplication import factual_messages, thaw
from wisp_backend.api.dispatch import prepare_job
from wisp_backend.api.endpoints import ENDPOINTS
from wisp_backend.completion.context import ContextOverflow, render_messages, response_schema_for, select_context
from wisp_backend.config.settings import AssistantSettings
from wisp_backend.prompt_inspection.report import PROVIDERS, digest, encoded, inspect_scene
from wisp_backend.prompt_inspection.scenes import load_scene
from wisp_backend.providers.context_budget import CONTEXT_WINDOWS

ARTIFACT = Path(__file__).parents[1] / "fixtures/prompt_inspection/issue143_comparison.json"


async def capture(case: dict, allowance: int) -> dict:
    route, body, lore, _ = load_scene(case["scene_id"], case["locale"])
    if "beverage_case" in case:
        name = case["beverage_case"]
        body = {
            **body,
            "beveragePreference": (
                {"allowProposal": True}
                if name == "opt_in"
                else {
                    "allowProposal": False,
                    "current": {"value": "coffee" if name == "hypothesis" else "tea", "validity": name},
                }
            ),
        }
    job = prepare_job(ENDPOINTS[route].request_type.model_validate(body), lore)
    settings = AssistantSettings(provider=case["provider"])
    cap = min(settings.max_output_tokens, job.inference.max_output_tokens or settings.max_output_tokens)
    window = min(CONTEXT_WINDOWS[settings.provider, settings.model], job.inference.context_window or 16384)

    def deny(request: httpx.Request) -> httpx.Response:
        pytest.fail("Comparison attempted HTTP")

    async with httpx.AsyncClient(transport=httpx.MockTransport(deny), trust_env=False) as client:
        provider = PROVIDERS[settings.provider](client, settings)

        def payload(blocks):
            return provider.request(
                render_messages(blocks), settings, cap, response_schema=response_schema_for(blocks)
            )[1]

        def size(blocks):
            return provider.estimate_payload(payload(blocks), len(render_messages(blocks)))

        trace = []
        selected, status = (), "ok"
        required = tuple(b for b in job.inference.blocks if b.required)
        try:
            selected = select_context(job.inference.blocks, allowance, size, trace=trace)
        except ContextOverflow:
            status = "required_overflow"
        messages = render_messages(selected)
        outgoing = payload(selected) if status == "ok" else None
        return {
            "input_sha256": digest(body),
            "settings": settings.model_dump(),
            "status": status,
            "budget": {
                "context_window": window,
                "output_reserve": cap,
                "input_allowance": allowance,
                "required_estimate": size(required),
                "selected_estimate": size(selected) if status == "ok" else None,
            },
            "selected_keys": [block.key for block in selected],
            "blocks": [
                {
                    "key": b.key,
                    "source": b.source,
                    "required": b.required,
                    "priority": b.priority,
                    "order": b.order,
                    "messages": render_messages((b,)),
                    "server_instructions": b.server_instructions,
                }
                for b in job.inference.blocks
            ],
            "trace": [asdict(item) for item in trace],
            "messages": messages,
            "payload": outgoing,
            "payload_utf8_bytes": len(encoded(outgoing)) if outgoing is not None else None,
            "messages_sha256": digest(messages),
            "payload_sha256": digest(outgoing),
        }


def test_comparison_preserves_inputs_facts_budgets_and_explains_atomic_selection() -> None:
    archive = json.loads(ARTIFACT.read_bytes())
    assert archive["synthetic"] is True and archive["provider_calls"] == 0
    rows = thaw(archive["rows"], archive["text_pool"])
    assert len(rows) == 132

    async def run():
        for row in rows:
            before, recorded = row["before"], row["after"]
            current = await capture(row["case"], before["budget"]["input_allowance"])
            assert current["input_sha256"] == row["input_sha256"] == recorded["input_sha256"]
            for result in (current, recorded):
                assert result["settings"] == before["settings"]
                for key in ("context_window", "output_reserve", "input_allowance"):
                    assert result["budget"][key] == before["budget"][key]
                original = {b["key"]: b for b in row["before_blocks"]}
                assert original.keys() == {b["key"] for b in result["blocks"]}
                for block in result["blocks"]:
                    old = original[block["key"]]
                    for key in ("source", "required", "priority", "order"):
                        assert block[key] == old[key]
                    assert factual_messages(block) == factual_messages(old)
                if result["status"] == "ok":
                    assert result["budget"]["selected_estimate"] <= result["budget"]["input_allowance"]
                    assert {b["key"] for b in result["blocks"] if b["required"]} <= set(result["selected_keys"])
                    history = [int(k.split("_")[1]) for k in result["selected_keys"] if k.startswith("history_")]
                    total = sum(b["source"] == "dialogue" and b["key"] != "current_user" for b in result["blocks"])
                    if history:
                        assert history == list(range(history[0], total))
                else:
                    assert result["messages"] == [] and result["payload"] is None
            for result in (before, recorded):
                assert digest(result["messages"]) == result["messages_sha256"]
                assert digest(result["payload"]) == result["payload_sha256"]
                if result["payload"] is not None:
                    assert len(encoded(result["payload"])) == result["payload_utf8_bytes"]

    asyncio.run(run())


@pytest.mark.parametrize("provider", ["openai", "gemini"])
def test_inspector_reports_active_annotations_schema_and_rendered_roles(provider: str) -> None:
    async def run():
        for budget in ("normal", "required_only"):
            report = await inspect_scene("long_context", "en", provider, budget_case=budget)
            attached = {b["key"] for b in report["blocks"] if b["conditional_instructions"]}
            assert attached == {"lore", "summary", "previous_initiative"}
            active = attached & set(report["selected_keys"])
            assert set(report["active_optional_instructions"]) == active
            assert active == (attached if budget == "normal" else set())
            for block in report["blocks"]:
                if block["key"] in attached:
                    assert block["roles"] == ["system", "user"]
            beverage = await inspect_scene(
                "greeting_low_trust", "en", provider, budget_case=budget, beverage_case="opt_in"
            )
            assert beverage["active_optional_instructions"] == (["beverage_preference"] if budget == "normal" else [])
            assert beverage["active_response_schema"] == ("beverage_proposal" if budget == "normal" else None)

    asyncio.run(run())
