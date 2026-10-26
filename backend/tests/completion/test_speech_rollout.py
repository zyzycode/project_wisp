"""Approved #121 speech examples, paired construction and explicit historical replay."""

import asyncio
import copy
import hashlib
import json
from dataclasses import replace
from pathlib import Path
from typing import Any
from unittest.mock import patch

import httpx
import pytest
from tests.completion.test_prompt_selection import scene_context
from wisp_backend.completion.prompts.blocks import common_blocks
from wisp_backend.completion.prompts.narrative import dialogue_examples
from wisp_backend.completion.prompts.resources import RESOURCE_PATH, get_prompt_resources, parse_resources
from wisp_backend.completion.prompts.selection import select_prompt_resources
from wisp_backend.prompt_inspection.report import digest, inspect_scene, source_digests
from wisp_backend.prompt_inspection.scenes import load_scene

ROOT = Path(__file__).parents[1] / "fixtures/prompt_inspection"


def artifact() -> dict[str, Any]:
    return json.loads((ROOT / "issue121_comparison.json").read_text())


def test_resource_delta_is_only_four_approved_chat_records_and_revision() -> None:
    data = artifact()
    old, new = (copy.deepcopy(data["resource_changes"][stage]) for stage in ("before", "after"))
    assert new == json.loads(RESOURCE_PATH.read_text())
    assert old["revision"] == "wisp-prompts-4" and new["revision"] == "wisp-prompts-5"
    assert old["texts"] == new["texts"]
    for locale in ("ru", "en"):
        assert old["examples"][locale]["touch"] == new["examples"][locale]["touch"]
        assert old["examples"][locale]["event"] == new["examples"][locale]["event"]
        for a, b in zip(old["examples"][locale]["chat"], new["examples"][locale]["chat"], strict=True):
            assert (a["id"], a["predicate"]) == (b["id"], b["predicate"])
            assert set(a) == set(b)
            assert a["alternatives"] != b["alternatives"]
            assert len(b["alternatives"]) == 1 and "*" not in b["alternatives"][0]
    assert [entry["alternatives"][0] for entry in new["examples"]["ru"]["chat"]] == [
        "Сначала освободим проход. Потом по одной коробке — мой прошлый план уже показал, как не надо",
        "План был быстрый. Теперь до двери добраться бы",
        "Хорошо, больше не шучу об этом",
        "Здорово, доделал! Что оказалось самым противным?",
    ]
    for name, expected in data["preserved_archives"].items():
        assert hashlib.sha256((ROOT / name).read_bytes()).hexdigest() == expected
    sources = data["before_source_digests"]
    assert set(data["source_changes"]) == {"completion/prompts/prompt_resources.json"}
    for path, delta in data["source_changes"].items():
        assert sources[path] == delta["before"]
        sources[path] = delta["after"]
    assert source_digests() == sources
    assert data["quality"]["provider_calls"] == 0 and data["quality"]["status"] == "NOT RUN"


@pytest.mark.parametrize("legacy", [False, True])
def test_same_inputs_reproduce_each_report_without_http(monkeypatch: pytest.MonkeyPatch, legacy: bool) -> None:
    data = artifact()
    snapshot = parse_resources((ROOT / "issue121_legacy_resources.json").read_bytes())
    current = get_prompt_resources()

    async def forbidden(*args: object, **kwargs: object) -> None:
        pytest.fail("Speech inspection must not call a provider")

    monkeypatch.setattr(httpx.AsyncClient, "send", forbidden)
    monkeypatch.setattr(
        "wisp_backend.completion.prompts.selection.get_prompt_resources", lambda: snapshot if legacy else current
    )
    monkeypatch.setattr(
        "wisp_backend.prompt_inspection.report.get_prompt_resources", lambda: snapshot if legacy else current
    )

    async def run() -> None:
        assert len(data["records"]) == 32
        for row in data["records"]:
            case = row["case"]
            route, _, lore, metadata = load_scene(case["scene_id"], case["locale"])
            with patch(
                "wisp_backend.prompt_inspection.report.load_scene", return_value=(route, row["input"], lore, metadata)
            ):
                report = await inspect_scene(**case)
            if legacy:
                for path, delta in data["source_changes"].items():
                    assert report["source_digests"][path] == delta["after"]
                    report["source_digests"][path] = delta["before"]
            if not legacy:
                with (
                    patch("wisp_backend.completion.prompts.selection.get_prompt_resources", return_value=snapshot),
                    patch("wisp_backend.prompt_inspection.report.get_prompt_resources", return_value=snapshot),
                    patch(
                        "wisp_backend.prompt_inspection.report.load_scene",
                        return_value=(route, row["input"], lore, metadata),
                    ),
                ):
                    old = await inspect_scene(**case)
                assert [b for b in old["blocks"] if b["key"] != "examples"] == [
                    b for b in report["blocks"] if b["key"] != "examples"
                ]
                assert [m for m in old["messages"] if not m["content"].startswith("Synthetic style examples (")] == [
                    m for m in report["messages"] if not m["content"].startswith("Synthetic style examples (")
                ]
                assert old["resource_selection"] == report["resource_selection"]
            expected = row["before" if legacy else "after"]
            assert digest(report) == expected["report_sha256"]
            assert report["budget"] == expected["budget"]
            unchanged = digest([b for b in report["blocks"] if b["key"] != "examples"])
            assert unchanged == row["before"]["non_example_blocks_sha256"] == row["after"]["non_example_blocks_sha256"]
            block = next(b for b in report["blocks"] if b["key"] == "examples")
            assert block == expected["example_block"]
            assert block["source"] == "server_examples" and not block["required"]
            assert block["roles"] == ["user"]
            assert report["messages"][-1] == row["input"]["messages"][-1]
            assert report["measurement"]["provider_count"] == "NOT RUN"
            if case["budget_case"] == "required_only":
                assert "examples" not in report["selected_keys"]
                assert block["decision"]["reason"] == "budget"
            else:
                assert "examples" in report["selected_keys"]
            for field in ("context_window", "output_reserve", "input_allowance", "required_estimate"):
                assert row["before"]["budget"][field] == row["after"]["budget"][field]
            assert row["before"]["settings"] == row["after"]["settings"]

    asyncio.run(run())


@pytest.mark.parametrize("locale", ["ru", "en"])
def test_style_is_not_a_text_classifier_or_evidence_and_current_state_wins(locale: str) -> None:
    context = scene_context("greeting_low_trust", locale)
    selected = select_prompt_resources(context, "chat")
    assert len(selected.examples) == 1 and selected.examples[0].predicate == "chat_guarded"
    blocks = {b.key: b for b in common_blocks(context, "Rules", "chat", memory={})}
    assert blocks["examples"].messages[0].content == dialogue_examples(selected.examples)
    marker = "only in this fictional scene" if locale == "en" else "вымышленной сцене"
    assert marker in selected.examples[0].payload()["state"]
    core = blocks["instructions"].messages[0].content
    for rule in (
        "never evidence",
        "Do not repeat them as past experiences",
        "current state and consent take precedence",
    ):
        assert rule in core
    assert selected.examples[0].payload()["alternatives"][0] not in blocks["memory"].messages[0].content
    assert select_prompt_resources(replace(context, user_consent_enabled=True), "chat").examples == ()
    no_match = replace(context, expression=replace(context.expression, trust="close", play="ordinary"))
    assert select_prompt_resources(no_match, "chat").examples == ()
    tired = replace(context, expression=replace(context.expression, pace="gentle", attention="high"))
    assert [x.predicate for x in select_prompt_resources(tired, "chat").examples] == ["chat_tired_company"]
    injection = scene_context("injection", locale)
    assert [x.id for x in select_prompt_resources(injection, "chat").examples] == [x.id for x in selected.examples]


def test_renderer_preserves_optional_authored_gestures_without_requiring_them() -> None:
    document = json.loads(RESOURCE_PATH.read_text())
    document["examples"]["en"]["chat"][0]["alternatives"] = ["*pauses* First, clear the way."]
    parsed = parse_resources(json.dumps(document).encode())
    entry = next(e for e in parsed.examples if e.id == "en-chat-1")
    assert "\nWisp: *pauses* First, clear the way." in dialogue_examples((entry,))
