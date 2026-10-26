"""Frozen #123/no-field equality and explicit enabled-only construction deltas."""

import asyncio
import hashlib
import json
from pathlib import Path

import pytest
from wisp_backend.prompt_inspection.report import digest, inspect_scene
from wisp_backend.providers.http_provider import HTTPProvider
from wisp_backend.providers.openai import OpenAIProvider

ROOT = Path(__file__).parents[1] / "fixtures/prompt_inspection"
BEFORE_HASH = "9c8095fba038212fb258933abd907db52793fea0d1122e5c70dde2dd34a6eb99"
SOURCE_ALLOWLIST = {
    "providers/openai.py",
    "providers/gemini.py",
    "api/schemas/interaction.py",
    "completion/context.py",
    "completion/policies.py",
    "completion/prompts/chat.py",
    "completion/prompts/beverage.py",
    "api/dispatch.py",
    "completion/prompts/context.py",
    "prompt_inspection/report.py",
}


def read(name: str) -> dict:
    return json.loads((ROOT / name).read_text())


def test_archives_hashes_source_allowlist_and_no_field_exact_equality() -> None:
    before, after, comparison = (read(f"issue114_{stage}.json") for stage in ("before", "after", "comparison"))
    assert hashlib.sha256((ROOT / "issue114_before.json").read_bytes()).hexdigest() == BEFORE_HASH
    for name, expected in comparison["preserved_archives"].items():
        assert hashlib.sha256((ROOT / name).read_bytes()).hexdigest() == expected
    for stage in ("before", "after", "enabled"):
        entry = comparison[stage]
        assert hashlib.sha256((ROOT / entry["path"]).read_bytes()).hexdigest() == entry["sha256"]
    assert set(comparison["source_changes"]) == SOURCE_ALLOWLIST
    old_sources, new_sources = before["reports"][0]["source_digests"], after["reports"][0]["source_digests"]
    for path in old_sources.keys() | new_sources.keys():
        if old_sources.get(path) != new_sources.get(path):
            assert comparison["source_changes"][path] == {
                "before": old_sources.get(path),
                "after": new_sources.get(path),
            }
    assert len(before["reports"]) == len(after["reports"]) == 120
    for old, new in zip(before["reports"], after["reports"], strict=True):
        assert {k: v for k, v in old.items() if k != "source_digests"} == {
            k: v for k, v in new.items() if k != "source_digests"
        }


def test_enabled_ru_en_both_providers_add_only_bundle_and_conditional_schema() -> None:
    rows = read("issue114_enabled.json")["reports"]
    assert len(rows) == 12
    for row in rows:
        old, new = row["baseline"], row["enabled"]
        for key in ("settings", "resource_selection", "resources", "absent_optional", "live_comparison"):
            assert old[key] == new[key]
        bundle = next(block for block in new["blocks"] if block["key"] == "beverage_preference")
        assert not bundle["required"] and bundle["priority"] < min(block["priority"] for block in old["blocks"])
        assert [block for block in new["blocks"] if block is not bundle] == old["blocks"]
        assert [key for key in new["selected_keys"] if key != bundle["key"]] == old["selected_keys"]
        extra = [message for message in new["messages"] if message not in old["messages"]]
        assert len(extra) == 2 and [item["role"] for item in extra] == ["system", "user"]
        assert [message for message in new["messages"] if message not in extra] == old["messages"]
        payload = json.loads(json.dumps(new["payload"]))
        if new["settings"]["provider"] == "openai":
            payload["messages"] = old["payload"]["messages"]
            schema = payload.pop("response_format")
            if row["case"] == "opt_in":
                assert schema["type"] == "json_schema"
                assert "beverageProposal" in schema["json_schema"]["schema"]["properties"]
            else:
                assert schema == old["payload"]["response_format"]
            payload["response_format"] = old["payload"]["response_format"]
        else:
            payload["contents"], payload["systemInstruction"] = (
                old["payload"]["contents"],
                old["payload"]["systemInstruction"],
            )
            schema = payload["generationConfig"].pop("responseJsonSchema", None)
            assert (schema is not None) is (row["case"] == "opt_in")
        assert payload == old["payload"]
        assert new["payload_sha256"] == digest(new["payload"])
        assert new["messages_sha256"] == digest(new["messages"])
        for key in ("context_window", "output_reserve", "input_allowance", "required_estimate"):
            assert new["budget"][key] == old["budget"][key]
        assert new["budget"]["selected_estimate"] <= new["budget"]["input_allowance"]


def test_archived_snapshots_replay_with_the_explicit_legacy_budget(monkeypatch: pytest.MonkeyPatch) -> None:
    # #118 intentionally changes runtime estimates/selection. Replay the frozen
    # #114 contract under its original estimator, then verify current sources.
    monkeypatch.setattr(OpenAIProvider, "estimate_payload", HTTPProvider.estimate_payload)
    monkeypatch.setattr(OpenAIProvider, "estimate_method", HTTPProvider.estimate_method)

    async def run():
        snapshots = read("issue114_after.json")["reports"]
        snapshots += [row["enabled"] for row in read("issue114_enabled.json")["reports"]]
        for expected in snapshots:
            settings = expected["settings"]
            current = await inspect_scene(
                expected["scene_id"],
                expected["locale"],
                settings["provider"],
                settings["model"],
                max_output_tokens=settings["max_output_tokens"],
                temperature=settings["temperature"],
                thinking_level=settings["thinking_level"],
                budget_case=expected["budget_case"],
                beverage_case=expected.get("beverage_case"),
            )
            # #120 changes only shipped-catalogue provenance; these scenes retain
            # their frozen synthetic lore. Compare every other byte/selection field.
            lore_path = "completion/prompts/lore.json"
            lore_file = Path(__file__).parents[2] / "wisp_backend" / lore_path
            assert json.loads(lore_file.read_text()) == {"formatVersion": 1, "revision": 2, "entries": []}
            current_hash = hashlib.sha256(lore_file.read_bytes()).hexdigest()
            assert current_hash == "381a8e3f5a9ecf90bee09e9d0438db6be2ede789b7fd4ebe2ef0c0bc7bca773d"
            assert current["source_digests"][lore_path] == current_hash
            assert expected["source_digests"][lore_path] != current_hash
            sources = {**expected["source_digests"], lore_path: current_hash}
            changes = read("issue118_comparison.json")["source_changes"]
            assert set(changes) == {
                "providers/context_budget.py",
                "providers/http_provider.py",
                "providers/openai.py",
                "prompt_inspection/report.py",
            }
            for path, delta in changes.items():
                assert sources.get(path) == delta["before"]
                sources[path] = delta["after"]
            adjusted = {**expected, "source_digests": sources}
            assert current == adjusted

    asyncio.run(run())
