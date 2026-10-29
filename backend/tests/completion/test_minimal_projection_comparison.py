"""Keep the offline projection comparison auditable without freezing authored wording."""

import asyncio
import copy
import hashlib
import json
from pathlib import Path

from tests.helpers import CONTRACT_FIXTURES
from wisp_backend.completion.prompts.narrative import reference_lines
from wisp_backend.prompt_inspection.report import digest, encoded, inspect_scene
from wisp_backend.prompt_inspection.scenes import SCENE_IDS, SCENES_PATH

ARCHIVE = Path(__file__).parents[1] / "fixtures/prompt_inspection/issue145_comparison.json"
REMOVED_BANDS = ("pace", "trust", "attention", "play")


def archive() -> dict:
    return json.loads(ARCHIVE.read_text(encoding="utf-8"))


def projected_character(character: dict) -> dict:
    result = copy.deepcopy(character)
    del result["synthesizedTone"]
    for band in REMOVED_BANDS:
        del result["expression"][band]
    assert set(result["expression"]) == {"romanceAllowed"}
    return result


def character_lines(messages: list[dict]) -> list[str]:
    blocks = [message["content"] for message in messages if message["content"].startswith("[Character card")]
    assert len(blocks) == 1
    return blocks[0].splitlines()[1:]


def test_archive_evidence_hashes_settings_and_measured_deltas_are_consistent() -> None:
    data = archive()
    assert data["synthetic"] is True
    objects = data["objects_by_sha256"]
    assert all(digest(value) == key for key, value in objects.items())
    expected_cases = {
        (scene, locale, provider)
        for scene in (*SCENE_IDS, "observation_fixture")
        for locale in ("ru", "en")
        for provider in ("openai", "gemini")
    }
    assert len(data["reports"]) == 124
    assert {(r["scene_id"], r["locale"], r["provider"]) for r in data["reports"]} == expected_cases
    for case in data["reports"]:
        before, after = case["before"], case["after"]
        assert before["settings"] == after["settings"]
        assert before["measurement"] == after["measurement"]
        assert before["identity_source"] == after["identity_source"]
        assert before["route"] == after["route"]
        for key in ("context_window", "output_reserve", "input_allowance"):
            assert before["budget"][key] == after["budget"][key]
        for side in (before, after):
            assert side["status"] == "ok"
            assert side["measurement"]["generation"] == "NOT RUN"
            assert side["live_comparison"]["status"] == "NOT RUN"
            assert side["payload_ref"] == side["payload_sha256"]
            assert side["messages_ref"] == side["messages_sha256"]
            assert len(encoded(objects[side["payload_ref"]])) == side["payload_utf8_bytes"]
            assert objects[side["source_digests_ref"]]
        baseline_sources = objects[before["source_digests_ref"]]
        assert (
            baseline_sources["completion/prompts/technical.py"]
            == hashlib.sha256(data["baseline_technical_source"].encode("utf-8")).hexdigest()
        )
        assert case["delta"]["payload_utf8_bytes"] == after["payload_utf8_bytes"] - before["payload_utf8_bytes"]
        counts = [
            sum(len(m["content"].encode("utf-16-le")) // 2 for m in objects[s["messages_ref"]]) for s in (before, after)
        ]
        assert case["delta"]["messages_utf16"] == counts[1] - counts[0]


def test_same_inputs_change_only_the_five_approved_character_leaves() -> None:
    data = archive()
    corpus = copy.deepcopy(data["input_corpus_before"])
    for scene in corpus["scenes"].values():
        for localized in scene.values():
            localized["body"]["character"] = projected_character(localized["body"]["character"])
    assert corpus == json.loads(SCENES_PATH.read_text(encoding="utf-8"))
    observation = copy.deepcopy(data["observation_input_before"])
    observation["character"] = projected_character(observation["character"])
    assert observation == json.loads(
        (CONTRACT_FIXTURES / "desktop-backend-v1/observation/request.valid.json").read_text(encoding="utf-8")
    )
    for case in data["reports"]:
        original = (
            data["observation_input_before"]
            if case["scene_id"] == "observation_fixture"
            else data["input_corpus_before"]["scenes"][case["scene_id"]][case["locale"]]["body"]
        )
        objects = data["objects_by_sha256"]
        assert character_lines(objects[case["before"]["messages_ref"]]) == reference_lines(original["character"])
        assert character_lines(objects[case["after"]["messages_ref"]]) == reference_lines(
            projected_character(original["character"])
        )


def test_current_offline_provider_preparation_keeps_the_recorded_character_facts() -> None:
    data = archive()

    async def verify() -> None:
        for case in data["reports"]:
            if case["scene_id"] == "observation_fixture":
                continue  # All four routes also exercise the live job builder in the API projection tests.
            report = await inspect_scene(case["scene_id"], case["locale"], case["provider"])
            expected = data["objects_by_sha256"][case["after"]["messages_ref"]]
            assert character_lines(report["messages"]) == character_lines(expected)
            for key in ("context_window", "output_reserve", "input_allowance"):
                assert report["budget"][key] == case["after"]["budget"][key]

    asyncio.run(verify())
