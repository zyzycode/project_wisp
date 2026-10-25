"""Frozen synthetic inputs for the issue 117 before/after prompt experiment."""

import asyncio
import hashlib
import json
from pathlib import Path

import httpx
import pytest
from wisp_backend.api.endpoints import ENDPOINTS
from wisp_backend.prompt_inspection.report import digest, encoded, inspect_scene
from wisp_backend.prompt_inspection.scenes import SCENE_IDS, SCENES_PATH

FIXTURES = Path(__file__).parents[1] / "fixtures/prompt_inspection"
INPUTS = FIXTURES / "issue117_inputs.json"
BEFORE = FIXTURES / "issue117_before.json"
ADDED_SCENES = {
    "multi_turn_banter",
    "touch_trace_unrelated",
    "touch_why_absent",
    "touch_suppressed",
    "consent_on",
    "consent_revoked",
    "state_changed",
    "no_example_match",
}


def test_experiment_corpus_covers_missing_ru_en_comparison_cases() -> None:
    corpus = json.loads(SCENES_PATH.read_text(encoding="utf-8"))
    assert ADDED_SCENES <= set(SCENE_IDS)
    for scene in ADDED_SCENES:
        assert set(corpus["scenes"][scene]) == {"ru", "en"}
    for locale in ("ru", "en"):
        body = {scene: variants[locale]["body"] for scene, variants in corpus["scenes"].items()}
        assert len(body["multi_turn_banter"]["messages"]) >= 5
        assert "previousTouch" in body["touch_trace_unrelated"]
        assert "previousTouch" not in body["touch_why_absent"]
        assert body["touch_why_absent"]["messages"] == body["touch_followup"]["messages"]
        assert body["touch_suppressed"]["previousTouch"]["effect"] == "suppressed"
        assert body["touch_suppressed"]["previousTouch"]["reason"] == "cooldown"
        assert body["consent_on"]["character"]["intimacy"]["userConsentEnabled"] is True
        assert body["consent_revoked"]["character"]["intimacy"]["userConsentEnabled"] is False
        assert body["consent_revoked"]["character"]["expression"]["romanceAllowed"] is False
        assert len(body["state_changed"]["messages"]) >= 3
        assert body["state_changed"]["character"]["expression"]["pace"] == "gentle"
        assert body["state_changed"]["previousTouch"]["energyBand"] == "rested"


def test_experiment_inputs_remain_frozen_across_prompt_changes() -> None:
    inputs = json.loads(INPUTS.read_text(encoding="utf-8"))
    assert inputs["synthetic"] is True
    assert inputs["corpus"] == json.loads(SCENES_PATH.read_text(encoding="utf-8"))
    assert inputs["inspection_options"] == {
        "provider": "openai",
        "model": "gpt-6-sol",
        "max_output_tokens": 4096,
        "temperature": 1.0,
        "thinking_level": None,
    }
    assert inputs["live"]["status"] == "NOT RUN"
    assert inputs["live"]["provider_calls"] == inputs["live"]["authorized_calls"] == 0
    cases = {(case["scene_id"], case["locale"], case["budget_case"]) for case in inputs["cases"]}
    normal = {(scene, locale, "normal") for scene in SCENE_IDS for locale in ("ru", "en")}
    diagnostics = {
        ("touch_followup", locale, budget) for locale in ("ru", "en") for budget in ("required_only", "overflow")
    }
    assert len(cases) == len(inputs["cases"]) == 48
    assert cases == normal | diagnostics
    for variants in inputs["corpus"]["scenes"].values():
        for scene in variants.values():
            ENDPOINTS[scene["route"]].request_type.model_validate(scene["body"])


def test_before_artifact_preserves_provenance_payloads_and_historical_fixtures() -> None:
    inputs = json.loads(INPUTS.read_text(encoding="utf-8"))
    before = json.loads(BEFORE.read_text(encoding="utf-8"))
    assert before["synthetic"] is True
    assert before["phase"] == "before-issue116"
    assert before["inputs_sha256"] == hashlib.sha256(INPUTS.read_bytes()).hexdigest()
    assert before["provenance"] == inputs["provenance"]
    assert before["inspection_options"] == inputs["inspection_options"]
    assert before["provenance"]["implementation_commit"] == "f93cc073d558db2df99d30d09541c32f868942a5"
    for name, expected_hash in before["provenance"]["preserved_historical_fixtures"].items():
        assert hashlib.sha256((FIXTURES / name).read_bytes()).hexdigest() == expected_hash
    for path, expected_hash in before["provenance"]["working_tree_source_overrides"].items():
        assert before["source_digests"][path.removeprefix("backend/wisp_backend/")] == expected_hash
    assert len(before["reports"]) == 48
    for case, report in zip(inputs["cases"], before["reports"], strict=True):
        assert {key: report[key] for key in case} == case
        assert report["source_commit"] == inputs["corpus"]["source_commit"]
        assert report["source_digests"] == before["source_digests"]
        assert report["resources"] == before["resources"]
        assert report["payload_sha256"] == digest(report["payload"])
        assert report["messages_sha256"] == digest(report["messages"])
        assert report["measurement"]["provider_count"] == "NOT RUN"
        assert report["live_comparison"]["status"] == "NOT RUN"
        assert set(report["live_comparison"]["scores_0_to_2"].values()) == {"NOT RUN"}
        if case["budget_case"] == "overflow":
            assert report["status"] == "required_overflow"
            assert report["payload"] is None and report["messages"] == []
            continue
        assert report["status"] == "ok"
        assert report["payload_utf8_bytes"] == len(encoded(report["payload"]))
        assert report["budget"]["selected_estimate"] == len(encoded(report["payload"])) + 256 + 64 * len(
            report["messages"]
        )
        assert report["budget"]["selected_estimate"] <= report["budget"]["input_allowance"]
        assert report["payload"]["messages"] == report["messages"]


def test_frozen_cases_use_real_inspector_and_explicit_settings_without_http(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    inputs = json.loads(INPUTS.read_text(encoding="utf-8"))

    async def forbidden(*args: object, **kwargs: object) -> None:
        pytest.fail("Synthetic comparison must never send provider/count HTTP")

    monkeypatch.setattr(httpx.AsyncClient, "send", forbidden)
    monkeypatch.setenv("OPENAI_API_KEY", "SYNTHETIC_SECRET_MUST_NOT_APPEAR")

    async def inspect_all() -> None:
        for case in inputs["cases"]:
            report = await inspect_scene(**case, **inputs["inspection_options"])
            assert {key: report["settings"][key] for key in inputs["inspection_options"]} == inputs[
                "inspection_options"
            ]
            assert report["measurement"]["generation"] == "NOT RUN"
            assert "SYNTHETIC_SECRET_MUST_NOT_APPEAR" not in json.dumps(report)
            if case["budget_case"] == "overflow":
                assert report["status"] == "required_overflow" and report["payload"] is None
                continue
            assert report["status"] == "ok"
            payload = report["payload"]
            assert {key: payload[key] for key in inputs["provider_payload_settings"]} == inputs[
                "provider_payload_settings"
            ]
            assert payload["model"] == "gpt-6-sol" and payload["temperature"] == 1.0
            assert payload["max_completion_tokens"] == report["budget"]["output_reserve"]
            assert report["budget"]["context_window"] == 16384
            assert report["budget"]["output_reserve"] == (4096 if report["route"] == "/v1/chat" else 1024)
            body = inputs["corpus"]["scenes"][case["scene_id"]][case["locale"]]["body"]
            assert ("previous_touch" in report["selected_keys"]) == ("previousTouch" in body)
            if case["scene_id"] == "no_example_match":
                assert "examples" not in report["selected_keys"]
                assert not any(item["eligible"] for item in report["resource_selection"] if item["kind"] == "example")
            if case["budget_case"] == "required_only":
                assert report["budget"]["selected_estimate"] == report["budget"]["input_allowance"]
                assert all(block["required"] for block in report["blocks"] if block["key"] in report["selected_keys"])
            else:
                assert report["budget"]["input_allowance"] == 16384 - report["budget"]["output_reserve"]

    asyncio.run(inspect_all())
    assert not caplog.records
