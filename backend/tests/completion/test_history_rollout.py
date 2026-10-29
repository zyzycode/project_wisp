"""Frozen history-capacity evidence, independent of the retired speech resources."""

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).parents[1] / "fixtures/prompt_inspection"


def digest(value: object) -> str:
    raw = json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()
    return hashlib.sha256(raw).hexdigest()


def test_archived_history_delta_preserves_sources_and_whole_pairs() -> None:
    artifact = json.loads((ROOT / "issue119_comparison.json").read_text())
    assert set(artifact["source_changes"]) == {"api/schemas/chat.py"}
    for path, delta in artifact["source_changes"].items():
        assert artifact["before_source_digests"][path] == delta["before"]
        assert delta["before"] != delta["after"]
    assert len(artifact["unchanged_scenes"]) == 250
    assert len(artifact["expanded_history"]) == 4
    for row in artifact["expanded_history"]:
        assert row["input_sha256"] == digest(row["input"])
        assert len(row["input"]["messages"]) == 21
        assert row["before"] == {"status": "invalid_request", "type": "ValidationError"}
        report, legacy = row["after"], row["legacy_three_pair_projection"]
        assert report["payload_sha256"] == digest(report["payload"])
        assert report["messages_sha256"] == digest(report["messages"])
        assert len([block for block in legacy["blocks"] if block["key"].startswith("history_")]) == 3
        assert len([block for block in report["blocks"] if block["key"].startswith("history_")]) == 10
        selected = [int(key.removeprefix("history_")) for key in report["selected_keys"] if key.startswith("history_")]
        assert len(selected) > 3 and selected == list(range(selected[0], 10))
        assert all(len(block["roles"]) == 2 for block in report["blocks"] if block["key"].startswith("history_"))
        assert report["messages"][-1] == row["input"]["messages"][-1]
        assert report["settings"] == legacy["settings"]
        for field in ("context_window", "output_reserve", "input_allowance"):
            assert report["budget"][field] == legacy["budget"][field]
        assert report["budget"]["selected_estimate"] <= report["budget"]["input_allowance"]
        assert report["measurement"]["provider_count"] == "NOT RUN"
    for name, expected in artifact["preserved_archives"].items():
        assert hashlib.sha256((ROOT / name).read_bytes()).hexdigest() == expected
