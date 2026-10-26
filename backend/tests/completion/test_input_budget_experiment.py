"""Current runtime budgets versus an explicit legacy replay; archived usage is separate."""

import asyncio
import hashlib
import json
from pathlib import Path
from unittest.mock import patch

import httpx
from wisp_backend.prompt_inspection.report import inspect_scene, source_digests
from wisp_backend.providers.context_budget import estimate_input, estimate_openai_input
from wisp_backend.providers.http_provider import HTTPProvider
from wisp_backend.providers.openai import OpenAIProvider

ROOT = Path(__file__).parents[1] / "fixtures/prompt_inspection"
CHANGED_SOURCES = {
    "providers/context_budget.py",
    "providers/http_provider.py",
    "providers/openai.py",
    "prompt_inspection/report.py",
}


def compact(report: dict) -> dict:
    return {
        key: report[key]
        for key in (
            "settings",
            "status",
            "measurement",
            "budget",
            "selected_keys",
            "payload_sha256",
            "messages_sha256",
            "payload_utf8_bytes",
            "blocks",
            "resources",
            "resource_selection",
        )
    }


def options(case: dict) -> dict:
    return {
        key: case[key]
        for key in ("scene_id", "locale", "provider", "model", "budget_case", "beverage_case")
        if key in case
    }


def test_current_runtime_and_legacy_replay_reproduce_every_compact_row_without_http(monkeypatch) -> None:
    artifact = json.loads((ROOT / "issue118_comparison.json").read_text())

    async def forbidden(*args, **kwargs):
        raise AssertionError("Offline inspection must never call a provider")

    monkeypatch.setattr(httpx.AsyncClient, "send", forbidden)

    async def run() -> None:
        for row in artifact["rows"]:
            after = await inspect_scene(**options(row["case"]))
            assert compact(after) == row["after"]
            # This replay validates identical inputs/final formatting with the old
            # budget, not the new runtime estimate. The after path above is unpatched.
            with (
                patch.object(OpenAIProvider, "estimate_payload", HTTPProvider.estimate_payload),
                patch.object(OpenAIProvider, "estimate_method", HTTPProvider.estimate_method),
            ):
                before = await inspect_scene(**options(row["case"]))
            assert compact(before) == row["before"]
            for old, new in zip(before["blocks"], after["blocks"], strict=True):
                # Budget decisions/costs may change; every block's source bytes,
                # mandatory flag, complete messages and priorities remain identical.
                assert {k: v for k, v in old.items() if k not in ("decision", "standalone_estimate")} == {
                    k: v for k, v in new.items() if k not in ("decision", "standalone_estimate")
                }
            assert before["settings"] == after["settings"]
            for key in ("context_window", "output_reserve"):
                assert before["budget"][key] == after["budget"][key]
            assert all(
                not key.startswith("history_") or len(next(b for b in after["blocks"] if b["key"] == key)["roles"]) == 2
                for key in after["selected_keys"]
            )
            if after["status"] == "ok":
                assert after["budget"]["selected_estimate"] <= after["budget"]["input_allowance"]
            if row["case"]["model"] != "gpt-6-sol":
                assert compact(before) == compact(after)
        long_context = [
            row
            for row in artifact["rows"]
            if row["case"]["scene_id"] == "long_context" and row["case"]["model"] == "gpt-6-sol"
        ]
        assert {row["case"]["locale"] for row in long_context} == {"ru", "en"}
        for row in long_context:
            assert len([key for key in row["after"]["selected_keys"] if key.startswith("history_")]) > len(
                [key for key in row["before"]["selected_keys"] if key.startswith("history_")]
            )

    asyncio.run(run())
    assert set(artifact["source_changes"]) == CHANGED_SOURCES
    current_sources = source_digests()
    for path, delta in artifact["source_changes"].items():
        assert current_sources[path] == delta["after"]
        assert artifact["before_source_digests"].get(path) == delta["before"]
    for name, digest in artifact["preserved_archives"].items():
        assert hashlib.sha256((ROOT / name).read_bytes()).hexdigest() == digest


def test_historical_calibration_matches_archived_payload_and_endpoint_reported_usage() -> None:
    calibration = json.loads((ROOT / "issue118_calibration.json").read_text())
    reports = {}
    for phase in ("before", "after"):
        data = json.loads((ROOT / f"issue117_{phase}.json").read_text())
        for report in data["reports"]:
            if report["budget_case"] == "normal":
                reports[phase, report["scene_id"], report["locale"], report["route"]] = report
    live = json.loads((ROOT / "issue117_live.json").read_text())
    assert len(live["calls"]) == len(calibration["rows"]) == 88
    known = 0
    for call, row in zip(live["calls"], calibration["rows"], strict=True):
        report = reports[call["phase"], call["scene_id"], call["locale"], call["route"]]
        assert call["payload_sha256"] == report["payload_sha256"] == row["payload_sha256"]
        count = len(report["messages"])
        assert estimate_input(report["payload"], count) == row["historical_estimate"]
        assert (
            estimate_openai_input(report["payload"], count)
            == row["candidate_estimates"]["lead_ascii3_cyrillic1_fallbackbytes_safety20"]
        )
        assert row["input_tokens"] == (call["usage"]["input_tokens"] if call["usage"] else None)
        if row["input_tokens"] is not None:
            known += 1
            assert row["candidate_estimates"]["lead_ascii3_cyrillic1_fallbackbytes_safety20"] >= row["input_tokens"]
    assert known == 87  # Describes this archive only; not a tokenizer guarantee.
