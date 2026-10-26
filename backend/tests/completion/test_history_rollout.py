"""History-capacity delta through the existing offline inspector, with frozen archives."""

import asyncio
import copy
import hashlib
import json
from pathlib import Path
from unittest.mock import patch

import httpx
from wisp_backend.prompt_inspection.report import digest, inspect_scene, source_digests
from wisp_backend.prompt_inspection.scenes import load_scene

ROOT = Path(__file__).parents[1] / "fixtures/prompt_inspection"


def test_existing_scenes_are_byte_identical_except_the_declared_schema_source(
    monkeypatch, legacy_speech_resources
) -> None:
    artifact = json.loads((ROOT / "issue119_comparison.json").read_text())
    assert set(artifact["source_changes"]) == {"api/schemas/chat.py"}
    sources = artifact["before_source_digests"]
    for path, delta in artifact["source_changes"].items():
        assert sources[path] == delta["before"]
        sources[path] = delta["after"]
    resource_delta = json.loads((ROOT / "issue121_comparison.json").read_text())["source_changes"]
    assert set(resource_delta) == {"completion/prompts/prompt_resources.json"}
    for path, delta in resource_delta.items():
        assert sources[path] == delta["before"]
        sources[path] = delta["after"]
    assert source_digests() == sources

    async def forbidden(*args, **kwargs):
        raise AssertionError("Offline history inspection must never use HTTP")

    monkeypatch.setattr(httpx.AsyncClient, "send", forbidden)

    async def run() -> None:
        assert len(artifact["unchanged_scenes"]) == 250
        for row in artifact["unchanged_scenes"]:
            report = await inspect_scene(**row["case"])
            without_source = {key: value for key, value in report.items() if key != "source_digests"}
            assert digest(without_source) == row["report_without_source_sha256"]
        for row in artifact["expanded_history"]:
            case = row["case"]
            route, _, lore, metadata = load_scene(case["scene_id"], case["locale"])
            assert row["input_sha256"] == digest(row["input"])
            assert len(row["input"]["messages"]) == 21
            assert row["before"] == {"status": "invalid_request", "type": "ValidationError"}

            def scene(scene_id: str, locale: str):
                assert scene_id == case["scene_id"] and locale == case["locale"]
                return route, copy.deepcopy(row["input"]), lore, metadata

            with patch("wisp_backend.prompt_inspection.report.load_scene", scene):
                report = await inspect_scene(**case)
            assert {key: value for key, value in report.items() if key != "source_digests"} == row["after"]
            legacy = row["legacy_three_pair_projection"]
            assert len([block for block in legacy["blocks"] if block["key"].startswith("history_")]) == 3
            assert len([block for block in report["blocks"] if block["key"].startswith("history_")]) == 10
            selected = [
                int(key.removeprefix("history_")) for key in report["selected_keys"] if key.startswith("history_")
            ]
            assert len(selected) > 3 and selected == list(range(selected[0], 10))
            assert all(len(block["roles"]) == 2 for block in report["blocks"] if block["key"].startswith("history_"))
            assert report["messages"][-1] == row["input"]["messages"][-1]
            assert report["settings"] == legacy["settings"]
            for field in ("context_window", "output_reserve", "input_allowance"):
                assert report["budget"][field] == legacy["budget"][field]
            assert report["budget"]["selected_estimate"] <= report["budget"]["input_allowance"]
            assert report["measurement"]["provider_count"] == "NOT RUN"

    asyncio.run(run())
    for name, expected in artifact["preserved_archives"].items():
        assert hashlib.sha256((ROOT / name).read_bytes()).hexdigest() == expected
