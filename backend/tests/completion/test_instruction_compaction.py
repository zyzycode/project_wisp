"""Instruction-only reduction against the frozen pre-116 synthetic baseline."""

import asyncio
import json
from pathlib import Path

import httpx
import pytest
from wisp_backend.prompt_inspection.report import inspect_scene

FIXTURES = Path(__file__).parents[1] / "fixtures/prompt_inspection"


def test_compaction_reduces_required_chat_core_without_changing_noninstruction_blocks(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    inputs = json.loads((FIXTURES / "issue117_inputs.json").read_text(encoding="utf-8"))
    before = json.loads((FIXTURES / "issue117_before.json").read_text(encoding="utf-8"))

    async def forbidden(*args: object, **kwargs: object) -> None:
        pytest.fail("Instruction regression must not call a provider")

    monkeypatch.setattr(httpx.AsyncClient, "send", forbidden)

    async def run() -> None:
        checked = 0
        for case, original in zip(inputs["cases"], before["reports"], strict=True):
            if original["route"] != "/v1/chat" or case["budget_case"] != "normal":
                continue
            current = await inspect_scene(**case, **inputs["inspection_options"])
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

    asyncio.run(run())
