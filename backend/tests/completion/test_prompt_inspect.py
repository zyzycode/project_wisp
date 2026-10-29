"""Synthetic diagnostics share production selection and formatters without HTTP."""

import asyncio
import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path

import httpx
import pytest
from wisp_backend.api.dispatch import prepare_context
from wisp_backend.api.endpoints import ENDPOINTS
from wisp_backend.completion.context import (
    ContextBlock,
    ContextMessage,
    ContextOverflow,
    SelectionDecision,
    select_context,
    select_context_async,
)
from wisp_backend.completion.prompts.narrative import reference_lines
from wisp_backend.prompt_inspection.report import inspect_scene
from wisp_backend.prompt_inspection.scenes import SCENE_IDS, SCENES_PATH, load_scene

BASELINE = Path(__file__).parents[1] / "fixtures/prompt_inspection/baseline.json"


def test_synthetic_states_preserve_the_canonical_public_author_identity() -> None:
    corpus = json.loads(SCENES_PATH.read_text(encoding="utf-8"))
    source = corpus["identity_source"]
    preset = Path(__file__).resolve().parents[3] / source["path"]
    match = re.search(r"aiSelfConcept:\s*'([^']+)'", preset.read_text(encoding="utf-8"))
    assert match is not None
    identity = match.group(1)
    assert hashlib.sha256(preset.read_bytes()).hexdigest() == source["source_sha256"]
    assert hashlib.sha256(identity.encode()).hexdigest() == source["ai_self_concept_sha256"]
    for locales in corpus["scenes"].values():
        for scene in locales.values():
            assert scene["body"]["character"]["personality"]["aiSelfConcept"] == identity
            assert scene["body"]["character"]["personality"]["presetId"] == source["preset_id"]
            if "card" in scene["body"]:
                assert scene["body"]["card"]["revision"] == source["card_revision"]


def test_full_synthetic_corpus_preserves_facts_and_budgets_without_speech_resources(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    async def forbidden(*args: object, **kwargs: object) -> None:
        pytest.fail("Offline inspection must not perform count or generation HTTP")

    monkeypatch.setattr(httpx.AsyncClient, "send", forbidden)
    monkeypatch.setenv("OPENAI_API_KEY", "SYNTHETIC_SECRET_MUST_NOT_APPEAR")

    async def run() -> None:
        for provider in ("openai", "gemini"):
            for locale in ("ru", "en"):
                for scene in SCENE_IDS:
                    report = await inspect_scene(scene, locale, provider)
                    route, body, lore, _ = load_scene(scene, locale)
                    context = prepare_context(ENDPOINTS[route].request_type.model_validate(body), lore)
                    rendered = next(
                        item["content"]
                        for item in report["messages"]
                        if item["content"].startswith("[Character card & current factual state]")
                    )
                    assert all(line in rendered.splitlines() for line in reference_lines(context.character))
                    assert "resources" not in report and "resource_selection" not in report
                    assert all(b["source"] != "server_examples" for b in report["blocks"])
                    assert all(not key.startswith("guidance_") for key in report["selected_keys"])
                    assert report["measurement"]["provider_count"] == "NOT RUN"
                    assert report["live_comparison"]["status"] == "NOT RUN"
                    assert "SYNTHETIC_SECRET_MUST_NOT_APPEAR" not in json.dumps(report)
                    assert report["budget"]["selected_estimate"] <= report["budget"]["input_allowance"]
                    assert report["payload"] is not None

    asyncio.run(run())
    assert not caplog.records


@pytest.mark.parametrize("provider", ["gemini", "openai"])
def test_required_boundary_and_overflow_are_explained(provider: str) -> None:
    boundary = asyncio.run(inspect_scene("touch_followup", "ru", provider, budget_case="required_only"))
    assert boundary["status"] == "ok"
    assert boundary["budget"]["selected_estimate"] == boundary["budget"]["input_allowance"]
    assert "previous_touch" in boundary["selected_keys"]
    assert "examples" not in boundary["selected_keys"]
    overflow = asyncio.run(inspect_scene("touch_followup", "ru", provider, budget_case="overflow"))
    assert overflow["status"] == "required_overflow"
    assert overflow["payload"] is None and overflow["messages"] == []
    for block in overflow["blocks"]:
        assert block["decision"]["reason"] == ("required_overflow" if block["required"] else "not_evaluated_overflow")
    assert overflow["budget"]["output_reserve"] == boundary["budget"]["output_reserve"] == 4096


def test_trace_explains_history_suffix_and_empty_optionals_without_changing_selection() -> None:
    blocks = (
        ContextBlock("required", "dialogue", True, 1000, 100, (ContextMessage("user", "x"),)),
        ContextBlock("old", "dialogue", False, 100, 50, (ContextMessage("user", "x"),)),
        ContextBlock("middle", "dialogue", False, 100, 52, (ContextMessage("user", "xxxx"),)),
        ContextBlock("new", "dialogue", False, 100, 54, (ContextMessage("user", "x"),)),
        ContextBlock("empty", "lore", False, 10, 30, ()),
    )

    def size(candidate: tuple[ContextBlock, ...]) -> int:
        return sum(len(message.content) for block in candidate for message in block.messages)

    trace: list[SelectionDecision] = []
    original = select_context(blocks, 3, size)
    assert select_context(blocks, 3, size, trace=trace) == original
    assert {decision.key: decision.reason for decision in trace} == {
        "required": "required",
        "new": "selected",
        "middle": "budget",
        "old": "history_suffix",
        "empty": "empty_optional",
    }

    async def run() -> None:
        async def count(candidate: tuple[ContextBlock, ...]) -> int:
            return size(candidate)

        for budget in (3, 100):
            async_trace: list[SelectionDecision] = []
            assert await select_context_async(blocks, budget, count, trace=async_trace) == await select_context_async(
                blocks, budget, count
            )
            assert len(async_trace) == len(blocks)
        for inspected in (None, []):
            with pytest.raises(ContextOverflow):
                await select_context_async(blocks, 0, count, trace=inspected)

    asyncio.run(run())


def test_optional_absence_and_provider_formatting_are_visible() -> None:
    gemini = asyncio.run(inspect_scene("greeting_low_trust", "en", "gemini"))
    openai = asyncio.run(inspect_scene("greeting_low_trust", "en", "openai"))
    assert {entry["key"] for entry in openai["absent_optional"]} == {
        "summary",
        "lore",
        "previous_initiative",
        "previous_touch",
        "history",
    }
    assert openai["payload"]["messages"] == openai["messages"]
    assert openai["payload"]["store"] is False
    assert gemini["payload"]["systemInstruction"]["parts"][0]["text"] == gemini["messages"][0]["content"]
    assert gemini["measurement"]["gemini_selection_is_estimated"] is True
    assert gemini["measurement"]["not_tokenizer_or_billing"] is True


@pytest.mark.parametrize(
    "options",
    [
        {"scene_id": "../../private"},
        {"locale": "fr"},
        {"provider": "unknown"},
        {"model": "arbitrary"},
        {"provider": "groq", "model": "gpt-4.1-mini"},
        {"budget_case": "arbitrary"},
        {"thinking_level": "high"},
        {"provider": "openai", "model": "gpt-6-astra", "temperature": 1.0},
    ],
)
def test_inspector_rejects_arbitrary_inputs(options: dict[str, object]) -> None:
    with pytest.raises(ValueError):
        asyncio.run(inspect_scene(**({"scene_id": "tired"} | options)))


def test_command_works_outside_repository_without_test_fixtures(tmp_path: Path) -> None:
    backend = Path(__file__).resolve().parents[2]
    env = {**os.environ, "PYTHONPATH": str(backend), "OPENAI_API_KEY": "SYNTHETIC_SECRET_MUST_NOT_APPEAR"}
    completed = subprocess.run(
        [sys.executable, "-m", "wisp_backend.prompt_inspect", "--scene", "tired", "--locale", "ru"],
        cwd=tmp_path,
        env=env,
        input="ignored synthetic stdin",
        capture_output=True,
        text=True,
        check=True,
    )
    report = json.loads(completed.stdout)
    assert report["synthetic"] is True
    assert report["settings"]["provider"] == "openai"
    assert report["settings"]["model"] == "gpt-6-sol"
    assert completed.stderr == ""
    assert "SYNTHETIC_SECRET_MUST_NOT_APPEAR" not in completed.stdout
    invalid = subprocess.run(
        [sys.executable, "-m", "wisp_backend.prompt_inspect", "--scene", str(tmp_path / "private.json")],
        cwd=tmp_path,
        env=env,
        capture_output=True,
        text=True,
    )
    assert invalid.returncode == 2 and not invalid.stdout
