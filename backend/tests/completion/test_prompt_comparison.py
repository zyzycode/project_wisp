"""Reproduce the synthetic before/after artifact without replacing the baseline."""

import asyncio
import hashlib
import json
from pathlib import Path
from typing import Any

from tests.completion.test_prompt_selection import scene_context
from wisp_backend.prompt_inspection.report import encoded, inspect_scene

ROOT = Path(__file__).parents[1] / "fixtures/prompt_inspection"
BASELINE = ROOT / "baseline.json"
COMPARISON = ROOT / "selection_comparison.json"


def _replace_text(value: Any, original: str, replacement: str) -> Any:
    if isinstance(value, str):
        return replacement if value == original else value
    if isinstance(value, list):
        return [_replace_text(item, original, replacement) for item in value]
    if isinstance(value, dict):
        return {key: _replace_text(item, original, replacement) for key, item in value.items()}
    return value


def comparison_record(before: dict[str, Any], after: dict[str, Any]) -> dict[str, Any]:
    character_message = next(
        message["content"] for message in after["messages"] if message["content"].startswith("[Current State & Mood]")
    )
    expression = scene_context(after["scene_id"], after["locale"]).character["expression"]
    reference = character_message.split("[Character card & supporting state]", 1)[1]
    without_expression = _replace_text(after["payload"], character_message, reference)
    overhead = len(encoded(after["payload"])) - len(encoded(without_expression))
    before_size = before["budget"]["selected_estimate"]
    after_size = after["budget"]["selected_estimate"]
    return {
        "scene": after["scene_id"],
        "locale": after["locale"],
        "provider": after["settings"]["provider"],
        "expression": expression,
        "before_estimate": before_size,
        "after_estimate": after_size,
        "estimate_delta": after_size - before_size,
        "projection_utf8_payload_bytes": overhead,
        "prompt_and_selection_estimate_delta": after_size - before_size - overhead,
        "before_selected_keys": before["selected_keys"],
        "after_selected_keys": after["selected_keys"],
        "resources": after["resource_selection"],
        "blocks": [
            {
                "key": block["key"],
                "selected": block["key"] in after["selected_keys"],
                "reason": block["decision"]["reason"],
                "utf8_bytes": block["utf8_bytes"],
            }
            for block in after["blocks"]
        ],
        "live_comparison": after["live_comparison"],
    }


async def comparison_artifact() -> dict[str, Any]:
    baseline = json.loads(BASELINE.read_text(encoding="utf-8"))
    records = []
    resources = None
    for before in baseline["reports"]:
        settings = before["settings"]
        if settings["provider"] not in {"openai", "gemini"}:
            continue
        after = await inspect_scene(
            before["scene_id"],
            before["locale"],
            settings["provider"],
            settings["model"],
            max_output_tokens=settings["max_output_tokens"],
            temperature=settings["temperature"],
            thinking_level=settings["thinking_level"],
        )
        resources = after["resources"]
        records.append(comparison_record(before, after))
    return {
        "synthetic": True,
        "baseline_sha256": hashlib.sha256(BASELINE.read_bytes()).hexdigest(),
        "baseline_source_commit": baseline["source_commit"],
        "resources": resources,
        "method": "offline UTF-8 payload JSON bytes + 256 + 64 * message count; not tokenizer or billing",
        "projection_note": "Projection bytes are measured in the same formatted payload with the narrative state cues removed; no HTTP or compatibility path.",
        "quality": "NOT RUN; byte changes do not establish live response quality.",
        "records": records,
    }


def test_comparison_artifact_reproduces_active_providers_with_historical_settings() -> None:
    expected = json.loads(COMPARISON.read_text(encoding="utf-8"))
    assert len(expected["records"]) == 84
    expected["records"] = [record for record in expected["records"] if record["provider"] in {"openai", "gemini"}]
    assert len(expected["records"]) == 56
    assert asyncio.run(comparison_artifact()) == expected
    for record in expected["records"]:
        assert record["projection_utf8_payload_bytes"] > 0
        assert record["live_comparison"]["status"] == "NOT RUN"
