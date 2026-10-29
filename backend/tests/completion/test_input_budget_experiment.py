"""Frozen estimator comparison and calibration, independent of old prompt builders."""

import hashlib
import json
from pathlib import Path

from wisp_backend.providers.context_budget import estimate_input, estimate_openai_input

ROOT = Path(__file__).parents[1] / "fixtures/prompt_inspection"
CHANGED_SOURCES = {
    "providers/context_budget.py",
    "providers/http_provider.py",
    "providers/openai.py",
    "prompt_inspection/report.py",
}


def test_archived_budget_comparison_preserves_blocks_and_settings() -> None:
    artifact = json.loads((ROOT / "issue118_comparison.json").read_text())
    assert len(artifact["rows"]) == 250
    for row in artifact["rows"]:
        before, after = row["before"], row["after"]
        assert before["settings"] == after["settings"]
        for key in ("context_window", "output_reserve"):
            assert before["budget"][key] == after["budget"][key]
        for old, new in zip(before["blocks"], after["blocks"], strict=True):
            assert {k: v for k, v in old.items() if k not in ("decision", "standalone_estimate")} == {
                k: v for k, v in new.items() if k not in ("decision", "standalone_estimate")
            }
        assert all(
            not key.startswith("history_") or len(next(b for b in after["blocks"] if b["key"] == key)["roles"]) == 2
            for key in after["selected_keys"]
        )
        if after["status"] == "ok":
            assert after["budget"]["selected_estimate"] <= after["budget"]["input_allowance"]
        if row["case"]["model"] != "gpt-6-sol":
            assert before == after
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
    assert set(artifact["source_changes"]) == CHANGED_SOURCES
    for path, delta in artifact["source_changes"].items():
        assert artifact["before_source_digests"].get(path) == delta["before"]
        assert artifact["after_source_digests"].get(path) == delta["after"]
    for name, expected in artifact["preserved_archives"].items():
        assert hashlib.sha256((ROOT / name).read_bytes()).hexdigest() == expected


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
