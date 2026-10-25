"""Frozen synthetic inputs for the issue 117 before/after prompt experiment."""

import asyncio
import hashlib
import json
from pathlib import Path
from typing import Any

import httpx
import pytest
from wisp_backend.api.endpoints import ENDPOINTS
from wisp_backend.prompt_inspection.report import digest, encoded, inspect_scene
from wisp_backend.prompt_inspection.scenes import SCENE_IDS, SCENES_PATH

FIXTURES = Path(__file__).parents[1] / "fixtures/prompt_inspection"
INPUTS = FIXTURES / "issue117_inputs.json"
BEFORE = FIXTURES / "issue117_before.json"
AFTER = FIXTURES / "issue117_after.json"
COMPARISON = FIXTURES / "issue117_comparison.json"
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
    expected_reports = json.loads(AFTER.read_text(encoding="utf-8"))["reports"]

    async def forbidden(*args: object, **kwargs: object) -> None:
        pytest.fail("Synthetic comparison must never send provider/count HTTP")

    monkeypatch.setattr(httpx.AsyncClient, "send", forbidden)
    monkeypatch.setenv("OPENAI_API_KEY", "SYNTHETIC_SECRET_MUST_NOT_APPEAR")

    async def inspect_all() -> None:
        for case, expected in zip(inputs["cases"], expected_reports, strict=True):
            report = await inspect_scene(**case, **inputs["inspection_options"])
            assert report == expected
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


def comparison_rows(before: dict[str, Any], after: dict[str, Any]) -> list[dict[str, Any]]:
    rows = []
    for old, new in zip(before["reports"], after["reports"], strict=True):
        row = {key: new[key] for key in ("scene_id", "locale", "route", "budget_case")}
        row["status"] = {"before": old["status"], "after": new["status"]}
        row["before_response"] = row["after_response"] = "NOT RUN"
        for field in ("payload_utf8_bytes", "required_estimate", "selected_estimate", "input_allowance"):
            previous = old[field] if field == "payload_utf8_bytes" else old["budget"][field]
            current = new[field] if field == "payload_utf8_bytes" else new["budget"][field]
            row[field] = {
                "before": previous,
                "after": current,
                "delta": None if previous is None or current is None else current - previous,
            }
        row["output_reserve"] = new["budget"]["output_reserve"]
        row["selected_keys"] = {"before": old["selected_keys"], "after": new["selected_keys"]}
        row["selected_history"] = {
            phase: [key for key in report["selected_keys"] if key.startswith("history_")]
            for phase, report in (("before", old), ("after", new))
        }
        row["added_keys"] = [key for key in new["selected_keys"] if key not in old["selected_keys"]]
        row["removed_keys"] = [key for key in old["selected_keys"] if key not in new["selected_keys"]]
        row["blocks"] = [
            {
                "key": block["key"],
                "required": block["required"],
                "before_utf8_bytes": original["utf8_bytes"],
                "after_utf8_bytes": block["utf8_bytes"],
                "before_selected": original["decision"]["included"],
                "after_selected": block["decision"]["included"],
                "before_reason": original["decision"]["reason"],
                "after_reason": block["decision"]["reason"],
            }
            for original, block in zip(old["blocks"], new["blocks"], strict=True)
        ]
        rows.append(row)
    return rows


def test_after_changes_only_instructions_and_consequent_budget_selection() -> None:
    before = json.loads(BEFORE.read_text(encoding="utf-8"))
    after = json.loads(AFTER.read_text(encoding="utf-8"))
    assert after["phase"] == "after-issue116"
    assert after["provenance"]["implementation_commit"] == "f8ca6147ede13ca864caac52b3b61dcbd64cf300"
    assert after["provenance"]["baseline_commit"] == "6729aac903f881fd85f90c469c6abb226f83ca12"
    assert after["before_sha256"] == hashlib.sha256(BEFORE.read_bytes()).hexdigest()
    for key in ("inputs_sha256", "resources", "inspection_options", "live", "report_counts"):
        assert after[key] == before[key]
    assert set(before["source_digests"]) == set(after["source_digests"])
    assert {
        path for path in before["source_digests"] if before["source_digests"][path] != after["source_digests"][path]
    } == {
        "completion/prompts/chat.py",
        "completion/prompts/interaction.py",
    }
    for old, new in zip(before["reports"], after["reports"], strict=True):
        for key in ("scene_id", "locale", "route", "budget_case", "status", "settings", "resources", "live_comparison"):
            assert old[key] == new[key]
        assert new["source_digests"] == after["source_digests"]
        assert new["budget"]["output_reserve"] == old["budget"]["output_reserve"]
        assert new["budget"]["context_window"] == old["budget"]["context_window"]
        if new["budget_case"] == "normal":
            assert new["budget"]["input_allowance"] == old["budget"]["input_allowance"]
        else:
            assert new["budget"]["input_allowance"] == new["budget"]["required_estimate"] - (
                new["budget_case"] == "overflow"
            )
        for original, block in zip(old["blocks"], new["blocks"], strict=True):
            for key in ("key", "source", "required", "priority", "order", "roles"):
                assert block[key] == original[key]
            if block["key"] != "instructions":
                assert {key: value for key, value in block.items() if key != "decision"} == {
                    key: value for key, value in original.items() if key != "decision"
                }
        for original, selection in zip(old["resource_selection"], new["resource_selection"], strict=True):
            assert {key: value for key, value in selection.items() if key not in ("included", "reason")} == {
                key: value for key, value in original.items() if key not in ("included", "reason")
            }
        assert new["payload_sha256"] == digest(new["payload"])
        assert new["messages_sha256"] == digest(new["messages"])
        if new["payload"] is not None:
            assert {key: value for key, value in new["payload"].items() if key != "messages"} == {
                key: value for key, value in old["payload"].items() if key != "messages"
            }


def test_comparison_table_reproduces_archived_reports_without_quality_claims() -> None:
    before = json.loads(BEFORE.read_text(encoding="utf-8"))
    after = json.loads(AFTER.read_text(encoding="utf-8"))
    comparison = json.loads(COMPARISON.read_text(encoding="utf-8"))
    assert comparison["records"] == comparison_rows(before, after)
    for name, path in (("before", BEFORE), ("after", AFTER), ("inputs", INPUTS)):
        assert comparison[f"{name}_sha256"] == hashlib.sha256(path.read_bytes()).hexdigest()
    assert comparison["live"]["status"] == "NOT RUN"
    assert comparison["live"]["provider_calls"] == 0
    assert comparison["quality_verdict"] == "NOT RUN"
    assert comparison["scores_0_to_2"] == before["reports"][0]["live_comparison"]["scores_0_to_2"]
    assert comparison["hard_failures"] == "NOT RUN (consent, evidence, format)"
    normal = [row for row in comparison["records"] if row["budget_case"] == "normal"]
    for summary in comparison["normal_summary"]:
        rows = [row for row in normal if row["route"] == summary["route"] and row["locale"] == summary["locale"]]
        assert summary["case_count"] == len(rows)
        for metric in ("payload_utf8_bytes", "required_estimate", "selected_estimate"):
            old = [row[metric]["before"] for row in rows]
            new = [row[metric]["after"] for row in rows]
            assert summary[metric] == {
                "before_total": sum(old),
                "after_total": sum(new),
                "delta_total": sum(new) - sum(old),
                "before_range": [min(old), max(old)],
                "after_range": [min(new), max(new)],
            }
