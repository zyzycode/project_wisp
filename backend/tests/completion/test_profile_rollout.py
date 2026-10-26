"""Current strict profile and paired offline construction; never claim model quality."""

import asyncio
import hashlib
import json
from pathlib import Path

import httpx
import pytest
from pydantic import ValidationError
from wisp_backend.api.endpoints import ENDPOINTS
from wisp_backend.api.schemas.interaction import CharacterCard
from wisp_backend.completion.prompts.resources import RESOURCE_PATH
from wisp_backend.prompt_inspection.report import digest, inspect_scene
from wisp_backend.prompt_inspection.scenes import SCENE_IDS

FIXTURES = Path(__file__).parents[1] / "fixtures/prompt_inspection"
BEFORE_HASH = "dd93ddb72e89e0508821f1914ce4874163ec3a16348253628e37b5731550ce65"
EXAMPLES_HASH = "ef7918df3f035dcda6370c42e024f4b02fd69e4c628eb1db87eaf63c2b21191c"
PROFILE_BLOCKS = {"instructions", "character_profile_state", "interaction_policy"}


@pytest.mark.parametrize(
    "card",
    [
        {"id": "shyDreamGirl", "revision": 1},
        {"id": "curiousStubbornGirl", "revision": 1},
        {"id": "shyDreamGirl", "revision": 2},
        {"id": "curiousStubbornGirl", "revision": True},
        {"id": "curiousStubbornGirl", "revision": 2.0},
    ],
)
def test_only_new_card_is_accepted_without_negotiation(card: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        CharacterCard.model_validate(card)
    assert CharacterCard.model_validate({"id": "curiousStubbornGirl", "revision": 2}).revision == 2


def test_profile_rollout_preserves_examples_bytes_and_all_archives() -> None:
    comparison = json.loads((FIXTURES / "issue123_comparison.json").read_text())
    for name, expected in comparison["preserved_archives"].items():
        assert hashlib.sha256((FIXTURES / name).read_bytes()).hexdigest() == expected
    resources = RESOURCE_PATH.read_text()
    assert hashlib.sha256(resources[resources.index('  "examples":') :].encode()).hexdigest() == EXAMPLES_HASH
    assert json.loads(resources)["revision"] == "wisp-prompts-4"
    assert "Let shy reserve" not in json.loads(resources)["texts"]["expression"]


def test_profile_comparison_enumerates_every_changed_message_and_source() -> None:
    before = json.loads((FIXTURES / "issue123_before.json").read_text())
    after = json.loads((FIXTURES / "issue123_after.json").read_text())
    comparison = json.loads((FIXTURES / "issue123_comparison.json").read_text())
    assert hashlib.sha256((FIXTURES / "issue123_before.json").read_bytes()).hexdigest() == BEFORE_HASH
    assert before["source_commit"] == "84eba098136b5aa44a852b5b6a34e64fa56286c3"
    assert before["identity_source"]["preset_id"] == "shyDreamGirl"
    assert after["identity_source"]["preset_id"] == "curiousStubbornGirl"
    for stage in ("before", "after"):
        assert (
            hashlib.sha256((FIXTURES / comparison[stage]["path"]).read_bytes()).hexdigest()
            == comparison[stage]["sha256"]
        )
    assert set(comparison["source_changes"]) == {
        "completion/prompts/character_guidance.py",
        "completion/prompts/prompt_resources.json",
        "prompt_inspection/scenes.json",
        "prompt_inspection/scenes.py",
        "api/schemas/interaction.py",
    }
    assert len(before["reports"]) == len(after["reports"]) == len(comparison["records"]) == 120
    assert len([key for key in SCENE_IDS if key.startswith("profile_")]) == 8
    for index, (old, new, row) in enumerate(
        zip(before["reports"], after["reports"], comparison["records"], strict=True)
    ):
        assert row["report_index"] == index
        for key in ("scene_id", "locale", "route", "settings", "budget_case", "status", "live_comparison"):
            assert old[key] == new[key]
        for key in ("context_window", "output_reserve", "input_allowance"):
            assert old["budget"][key] == new["budget"][key]
        assert new["payload_sha256"] == digest(new["payload"])
        assert new["messages_sha256"] == digest(new["messages"])
        changes = set()
        for a, b in zip(old["blocks"], new["blocks"], strict=True):
            for key in ("key", "source", "required", "priority", "order", "roles"):
                assert a[key] == b[key]
            if a["messages_sha256"] != b["messages_sha256"]:
                changes.add(a["key"])
            else:
                assert a["utf8_bytes"] == b["utf8_bytes"]
        assert changes <= PROFILE_BLOCKS
        assert changes == {block["key"] for block in row["changed_blocks"]}
        assert row["after_trace"] == [block["decision"] for block in new["blocks"]]
        assert row["before_selected_keys"] == old["selected_keys"]
        assert row["after_selected_keys"] == new["selected_keys"]
        assert new["budget"]["selected_estimate"] <= new["budget"]["input_allowance"]
        for message in row["changed_messages"]:
            assert message["path"].split("/")[2] in PROFILE_BLOCKS
            assert comparison["text_deltas"][message["delta"]]["hunks"]
    assert comparison["live_quality"]["status"] == "NOT RUN"
    assert comparison["live_quality"]["provider_calls"] == 0
    assert set(comparison["live_quality"]["scores_0_to_2"].values()) == {"NOT RUN"}


def test_current_inspector_reproduces_after_for_both_providers_without_http(monkeypatch: pytest.MonkeyPatch) -> None:
    async def forbidden(*args: object, **kwargs: object) -> None:
        pytest.fail("Offline comparison must not call provider/count APIs")

    monkeypatch.setattr(httpx.AsyncClient, "send", forbidden)
    after = json.loads((FIXTURES / "issue123_after.json").read_text())

    async def run() -> None:
        for expected in after["reports"]:
            settings = expected["settings"]
            actual = await inspect_scene(
                expected["scene_id"],
                expected["locale"],
                settings["provider"],
                settings["model"],
                max_output_tokens=settings["max_output_tokens"],
                temperature=settings["temperature"],
                thinking_level=settings["thinking_level"],
                budget_case=expected["budget_case"],
            )
            # #114 changes tracked source provenance only on the no-field route.
            current = json.loads((FIXTURES / "issue114_after.json").read_text())
            assert actual["source_digests"] == current["reports"][0]["source_digests"]
            assert {key: value for key, value in actual.items() if key != "source_digests"} == {
                key: value for key, value in expected.items() if key != "source_digests"
            }
            # The same API schemas admit all active synthetic chat/touch inputs.
            assert expected["route"] in ENDPOINTS

    asyncio.run(run())
