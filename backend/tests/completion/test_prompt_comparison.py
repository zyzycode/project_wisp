"""Preserve historical comparison evidence without replaying a removed prompt policy."""

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).parents[1] / "fixtures/prompt_inspection"


def test_archived_selection_comparison_retains_baseline_and_budget_arithmetic() -> None:
    baseline_path = ROOT / "baseline.json"
    baseline = json.loads(baseline_path.read_text())
    comparison = json.loads((ROOT / "selection_comparison.json").read_text())
    assert hashlib.sha256(baseline_path.read_bytes()).hexdigest() == comparison["baseline_sha256"]
    assert baseline["source_commit"] == comparison["baseline_source_commit"]
    assert len(comparison["records"]) == len(baseline["reports"]) == 84
    for row, original in zip(comparison["records"], baseline["reports"], strict=True):
        assert row["scene"] == original["scene_id"]
        assert row["locale"] == original["locale"]
        assert row["provider"] == original["settings"]["provider"]
        assert row["before_estimate"] == original["budget"]["selected_estimate"]
        assert row["before_selected_keys"] == original["selected_keys"]
        assert row["estimate_delta"] == row["after_estimate"] - row["before_estimate"]
        assert row["prompt_and_selection_estimate_delta"] == (
            row["estimate_delta"] - row["projection_utf8_payload_bytes"]
        )
        assert row["projection_utf8_payload_bytes"] > 0
        assert row["live_comparison"]["status"] == "NOT RUN"
        for block in row["blocks"]:
            assert block["selected"] == (block["key"] in row["after_selected_keys"])
            if block["reason"] == "required":
                assert block["selected"]
        for resource in row["resources"]:
            if resource["included"]:
                assert resource["block_key"] in row["after_selected_keys"]
