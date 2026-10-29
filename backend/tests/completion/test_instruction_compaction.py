"""Instruction-only reduction against the frozen pre-116 synthetic baseline."""

import json
from pathlib import Path

FIXTURES = Path(__file__).parents[1] / "fixtures/prompt_inspection"


def test_archived_compaction_reduces_core_without_changing_noninstruction_blocks() -> None:
    inputs = json.loads((FIXTURES / "issue117_inputs.json").read_text(encoding="utf-8"))
    before = json.loads((FIXTURES / "issue117_before.json").read_text(encoding="utf-8"))
    after = json.loads((FIXTURES / "issue117_after.json").read_text(encoding="utf-8"))

    checked = 0
    for case, original, current in zip(inputs["cases"], before["reports"], after["reports"], strict=True):
        if original["route"] != "/v1/chat" or case["budget_case"] != "normal":
            continue
        assert current["settings"] == original["settings"]
        for key in ("context_window", "output_reserve", "input_allowance"):
            assert current["budget"][key] == original["budget"][key]
        assert current["budget"]["required_estimate"] < original["budget"]["required_estimate"]
        assert current["resources"] == original["resources"]
        old_blocks = {block["key"]: block for block in original["blocks"]}
        assert {block["key"] for block in current["blocks"]} == set(old_blocks)
        for block in current["blocks"]:
            old = old_blocks[block["key"]]
            for key in ("required", "priority", "order", "source", "roles"):
                assert block[key] == old[key]
            if block["key"] != "instructions":
                for key in ("messages_sha256", "utf8_bytes", "utf16_units"):
                    assert block[key] == old[key]
        checked += 1
    assert checked >= 28
