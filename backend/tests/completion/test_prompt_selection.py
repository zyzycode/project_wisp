"""Semantic selection follows desktop cues and preserves mandatory constraints."""

import asyncio
import itertools
import json
from dataclasses import replace
from pathlib import Path

import pytest
from wisp_backend.api.dispatch import prepare_context
from wisp_backend.api.endpoints import ENDPOINTS
from wisp_backend.completion.prompts.context import CharacterPromptContext, ExpressionContext
from wisp_backend.completion.prompts.resources import RESOURCE_PATH, parse_resources
from wisp_backend.completion.prompts.selection import select_prompt_resources
from wisp_backend.prompt_inspection.report import inspect_scene
from wisp_backend.prompt_inspection.scenes import load_scene

EXPECTED = {
    "greeting_low_trust": "chat_guarded",
    "greeting_high_trust": "chat_playful_close",
    "praise": "chat_playful_close",
    "tired": "chat_tired_company",
    "combined_needs": "chat_tired_company",
    "boundary": None,
    "touch": "touch_gentle",
    "touch_followup": "chat_tired_company",
    "correction": "chat_guarded",
    "long_context": "chat_guarded",
    "injection": "chat_guarded",
    "no_match": None,
    "event_caught": None,
    "event_missed": "event_missed",
}


def scene_context(scene: str, locale: str = "en") -> CharacterPromptContext:
    route, body, lore, _ = load_scene(scene, locale)
    context = prepare_context(ENDPOINTS[route].request_type.model_validate(body), lore)
    assert isinstance(context, CharacterPromptContext)
    return context


@pytest.mark.parametrize("scene,predicate", EXPECTED.items())
@pytest.mark.parametrize("locale", ["ru", "en"])
def test_same_scenes_select_only_matching_examples(scene: str, predicate: str | None, locale: str) -> None:
    context = scene_context(scene, locale)
    mode = "touch" if scene == "touch" else "event" if scene.startswith("event_") else "chat"
    selection = select_prompt_resources(context, mode)
    assert [example.predicate for example in selection.examples] == ([] if predicate is None else [predicate])
    assert all(example.locale == locale and example.scenario == mode for example in selection.examples)
    assert select_prompt_resources(context, mode) == selection


def test_current_projection_dominates_raw_numbers_tone_old_reactions_and_consent() -> None:
    rested = scene_context("greeting_high_trust")
    tired = replace(rested, expression=ExpressionContext("gentle", "close", "high", "high", False))
    selected = select_prompt_resources(tired, "chat")
    assert [entry.predicate for entry in selected.examples] == ["chat_tired_company"]
    assert [block.key for block in selected.guidance] == ["guidance_0_gentle", "guidance_1_company", "guidance_3_trust"]
    assert next(item for item in selected.decisions if item.predicate == "play").reason == "gentle_suppresses_play"
    assert [entry.predicate for entry in select_prompt_resources(rested, "chat").examples] == ["chat_playful_close"]
    assert select_prompt_resources(replace(tired, user_consent_enabled=True), "chat").examples == ()
    # Follow-up text/trace cannot convert historical reactions into current consent.
    followup = replace(scene_context("touch_followup"), user_consent_enabled=True)
    assert select_prompt_resources(followup, "chat").examples == ()


def test_guidance_has_fixed_order_bounds_and_only_compatible_examples() -> None:
    context = scene_context("greeting_low_trust")
    combinations = itertools.product(
        ("gentle", "normal"),
        ("guarded", "familiar", "close"),
        ("high", "ordinary"),
        ("high", "ordinary"),
        (False, True),
    )
    for pace, trust, attention, play, consent in combinations:
        current = replace(
            context, expression=ExpressionContext(pace, trust, attention, play, False), user_consent_enabled=consent
        )
        for mode in ("chat", "touch"):
            selected = select_prompt_resources(current, mode)
            assert len(selected.examples) <= 1 and len(selected.guidance) <= 3
            assert [block.key for block in selected.guidance] == sorted(block.key for block in selected.guidance)
            assert len({block.messages[0].content for block in selected.guidance}) == len(selected.guidance)
            assert all(
                block.source == "server_instructions"
                and not block.required
                and block.priority == 20
                and block.order == 1
                for block in selected.guidance
            )
            if consent:
                assert not selected.examples
    touch = replace(
        scene_context("touch"), expression=ExpressionContext("normal", "familiar", "ordinary", "ordinary", False)
    )
    assert [entry.predicate for entry in select_prompt_resources(touch, "touch").examples] == ["touch_familiar"]


@pytest.mark.parametrize("provider", ["groq", "gemini", "openai"])
def test_optional_resources_disappear_at_boundary_without_losing_constraints(provider: str) -> None:
    report = asyncio.run(inspect_scene("combined_needs", "ru", provider, budget_case="required_only"))
    assert all(block["required"] for block in report["blocks"] if block["key"] in report["selected_keys"])
    core = report["messages"][0]["content"]
    for text in (
        "romanceAllowed is false",
        "energy is a resource",
        "High comfort does NOT mean",
        "never evidence",
        "appraisal",
        "memoryCandidates",
        "desktop alone owns",
    ):
        assert text in core
    assert "Never guilt" in core
    assert "friendship>=500" not in core and "comfort>=80" not in core
    assert not any(item["included"] for item in report["resource_selection"])
    assert any(item["reason"] == "budget" for item in report["resource_selection"])


def test_resource_predicates_are_closed_and_cannot_contain_expressions() -> None:
    raw = json.loads(RESOURCE_PATH.read_text(encoding="utf-8"))
    raw["examples"]["en"]["chat"][0]["predicate"] = "energy > 20"
    with pytest.raises(ValueError):
        parse_resources(json.dumps(raw).encode())
    raw["examples"]["en"]["chat"][0]["predicate"] = "touch_gentle"
    with pytest.raises(ValueError):
        parse_resources(json.dumps(raw).encode())
    raw["examples"]["en"]["chat"][0]["predicate"] = "chat_playful_close"
    with pytest.raises(ValueError, match="Duplicate example predicate"):
        parse_resources(json.dumps(raw).encode())


def test_selected_example_payloads_are_exact_subsets_of_the_original_baseline() -> None:
    baseline_path = Path(__file__).parents[1] / "fixtures/prompt_inspection/baseline.json"
    baseline = json.loads(baseline_path.read_text(encoding="utf-8"))
    originals = {}
    for report in baseline["reports"]:
        for message in report["messages"]:
            if message["content"].startswith("Synthetic style examples"):
                originals[(report["locale"], report["route"])] = json.loads(message["content"].split("\n", 1)[1])
    for scene in EXPECTED:
        for locale in ("ru", "en"):
            route, _, _, _ = load_scene(scene, locale)
            mode = {"/v1/chat": "chat", "/v1/touch": "touch", "/v1/events": "event"}[route]
            selected = select_prompt_resources(scene_context(scene, locale), mode)
            assert all(entry.payload() in originals[(locale, route)] for entry in selected.examples)
