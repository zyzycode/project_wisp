"""Audit the separately authorized, immutable six-scene prompt follow-up."""

import hashlib
import json
from pathlib import Path
from statistics import mean
from typing import Any

import pytest
from wisp_backend.completion.policies import POLICIES
from wisp_backend.prompt_inspection.report import digest, encoded

ROOT = Path(__file__).parents[1] / "fixtures/prompt_inspection"
INPUT_SHA = "8c20d678ae7cd72b5d5546c3037c60d3fec478a82ba93d822372c8c95ce82a5b"
MANIFEST_SHA = "93e583ae845477545b8437c9ec2a5016c436aa2d10e5e4ebc399bdc0620276b5"
CASES = ("combined_needs", "multi_turn_banter", "correction", "consent_revoked", "injection", "touch_followup")


@pytest.fixture(scope="module")
def experiment() -> dict[str, Any]:
    value = json.loads((ROOT / "issue116_followup_live.json").read_bytes())
    packet = json.loads((ROOT / value["frozen_inputs"]["file"]).read_bytes())
    reports = {(p["scene_id"], p["locale"]): p for p in packet["pairs"]}
    manifest = value["manifest"]
    references = manifest.pop("attempt_references")
    manifest["attempts"] = [
        {
            **{key: reference[key] for key in ("id", "scene_id", "locale", "variant", "sample")},
            "payload": reports[(reference["scene_id"], reference["locale"])][reference["variant"]]["payload"],
            "payload_sha256": reference["payload_sha256"],
            "selected_keys": reference["selected_keys"],
            **value["contexts"][reference["scene_id"] + "/" + reference["locale"]],
        }
        for reference in references
    ]
    return value


def test_followup_frozen_inputs_and_exact_noninstruction_context(experiment: dict[str, Any]) -> None:
    path = ROOT / experiment["frozen_inputs"]["file"]
    assert hashlib.sha256(path.read_bytes()).hexdigest() == INPUT_SHA
    packet = json.loads(path.read_bytes())
    assert tuple(packet["cases"]) == CASES
    assert packet["source_digests"] == experiment["manifest"]["source_digests"]
    runner = experiment["manual_helpers"]["wisp116_live.py"].encode()
    assert hashlib.sha256(runner).hexdigest() == experiment["manifest"]["runner_sha256"]
    assert len(packet["pairs"]) == 12
    assert packet["source_commit"] == "5485e43bb2f6aab0fff5636806e645bec9737616"
    for pair in packet["pairs"]:
        compact, verbose = pair["compact"], pair["verbose"]
        assert compact["status"] == verbose["status"] == "ok"
        assert compact["selected_keys"] == verbose["selected_keys"]
        assert compact["messages"][1:] == verbose["messages"][1:]
        assert compact["messages"][0]["role"] == verbose["messages"][0]["role"] == "system"
        assert compact["messages"][0]["content"] != verbose["messages"][0]["content"]
        assert compact["settings"] == verbose["settings"]
        assert compact["resources"] == verbose["resources"]
        for report in (compact, verbose):
            assert report["payload_sha256"] == digest(report["payload"])
            assert report["payload_utf8_bytes"] == len(encoded(report["payload"]))
            assert report["budget"]["input_allowance"] == 12288
            assert report["budget"]["output_reserve"] == 4096


def test_followup_authorized_cap_unique_order_and_actual_payloads(experiment: dict[str, Any]) -> None:
    manifest, ledger = experiment["manifest"], experiment["ledger"]
    assert digest(manifest) == experiment["manifest_sha256"] == MANIFEST_SHA
    assert manifest["endpoint"] == "https://api.openai.com/v1/chat/completions"
    assert ledger["manifest_sha256"] == MANIFEST_SHA
    assert ledger["status"] == "finished"
    assert len(manifest["attempts"]) == len(ledger["attempts"]) == 48
    assert len({item["id"] for item in ledger["attempts"]}) == 48
    assert ledger["reserved_output_tokens"] == 196608
    assert experiment["authorization"]["max_attempts"] == 48
    assert manifest["retries"] == experiment["authorization"]["retries"] == 0
    for expected, actual in zip(manifest["attempts"], ledger["attempts"], strict=True):
        assert actual["id"] == expected["id"]
        payload = expected["payload"]
        assert actual["payload_sha256"] == digest(payload) == expected["payload_sha256"]
        assert actual["payload_utf8_bytes"] == len(encoded(payload))
        assert actual["output_reserve"] == payload["max_completion_tokens"] == 4096
        assert payload["model"] == "gpt-6-sol" and payload["reasoning_effort"] == "none"
        assert payload["temperature"] == 1.0
        assert payload["store"] is payload["stream"] is False
        assert payload["response_format"] == {"type": "json_object"}
        assert actual["status"] != "attempt_reserved"
    for index in range(0, 24, 2):
        first, second = manifest["attempts"][index : index + 2]
        repeat_first, repeat_second = manifest["attempts"][index + 24 : index + 26]
        assert first["variant"] == repeat_second["variant"]
        assert second["variant"] == repeat_first["variant"]


def test_followup_raw_and_production_validation_remain_separate(experiment: dict[str, Any]) -> None:
    policy = next(p for p in POLICIES.values() if p.block_builder.__name__ == "build_interaction_chat_blocks")
    for attempt, result in zip(experiment["manifest"]["attempts"], experiment["ledger"]["attempts"], strict=True):
        assert "Authorization" not in result
        if "raw_response" not in result:
            continue
        quote = attempt["input"]["messages"][-1]["content"].strip()
        try:
            parsed = policy.parse_reply(result["raw_response"], quote, attempt["input"]["effectPolicy"])
        except ValueError:
            assert result["production_response"] is None
            assert "production_parse_failed" in result["raw_errors"]
        else:
            assert result["production_response"] == parsed.model_dump(exclude_unset=True)
        assert isinstance(result["raw_errors"], list)


def test_followup_blind_review_complete_frozen_before_unblinding(experiment: dict[str, Any]) -> None:
    review_info = experiment["review"]
    path = ROOT / review_info["file"]
    assert hashlib.sha256(path.read_bytes()).hexdigest() == review_info["sha256"]
    assert review_info["sha256"] == "24a52a0f9e2777c827ce19e3fe4b64542bbf8c31228ecee05d09b085ffa225d7"
    review = json.loads(path.read_bytes())
    mapping = review_info["blind_mapping"]
    assert review["phase_blind"] is True
    assert len(mapping) == len(review["scores"]) == 48
    assert set(mapping) == set(review["scores"])
    attempts = {item["id"]: item for item in experiment["ledger"]["attempts"]}
    inputs = {item["id"]: item for item in experiment["manifest"]["attempts"]}
    assert set(mapping.values()) == set(attempts)
    blinded = []
    for blind_id, attempt_id in mapping.items():
        result, original = attempts[attempt_id], inputs[attempt_id]
        blinded.append(
            {
                "blind_id": blind_id,
                "scene_id": original["scene_id"],
                "locale": original["locale"],
                "input": original["input"],
                "raw_response": result.get("raw_response"),
                "status": result["status"],
                "production_response": result.get("production_response"),
            }
        )
    blind_packet = {"issue": 116, "phase_blind": True, "items": sorted(blinded, key=lambda item: item["blind_id"])}
    raw = json.dumps(blind_packet, ensure_ascii=False, indent=2).encode()
    assert hashlib.sha256(raw).hexdigest() == review["blind_input_sha256"]


def test_followup_summary_recomputes_applicable_scores_hard_failures_and_usage(experiment: dict[str, Any]) -> None:
    review = json.loads((ROOT / experiment["review"]["file"]).read_bytes())
    mapping = experiment["review"]["blind_mapping"]
    attempts = {item["id"]: item for item in experiment["ledger"]["attempts"]}
    for variant, summary in experiment["review"]["summary"].items():
        rows = [(attempts[attempt_id], review["scores"][blind_id]) for blind_id, attempt_id in mapping.items()]
        rows = [(attempt, score) for attempt, score in rows if attempt["variant"] == variant]
        assert len(rows) == summary["samples"] == 24
        for axis, aggregate in summary["axes"].items():
            applicable = []
            for _, score in rows:
                value = score["axes"][axis]
                assert value["score"] in (0, 1, 2, None)
                assert value["observation"].strip()
                if value["score"] is not None:
                    applicable.append(value["score"])
            assert aggregate["applicable_count"] == len(applicable)
            assert aggregate["not_applicable_count"] == len(rows) - len(applicable)
            assert aggregate["mean"] == (mean(applicable) if applicable else None)
        for kind, count in summary["hard_failures"].items():
            assert count == sum(len(score["hard_failures"][kind]) for _, score in rows)
        for field, aggregate in summary["usage"].items():
            values = [attempt["usage"][field] for attempt, _ in rows if attempt.get("usage")]
            values = [value for value in values if value is not None]
            assert aggregate["known_count"] == len(values)
            assert aggregate["unknown_count"] == len(rows) - len(values)
            assert aggregate["sum_reported"] == (sum(values) if values else None)
    assert experiment["review"]["paired_comparison"]["complete_pairs"] == 24
    assert experiment["review"]["paired_comparison"]["unpaired_attempts"] == 0


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("issue117_inputs.json", "04e56cce675966494d303b1786bc02cde023a42225af988d7bfdda561afaeade"),
        ("issue117_before.json", "993c57a34237e3293036404d1ebc1a1193618c5e22fb762a40b49a6155b4af85"),
        ("issue117_after.json", "321f78880d381fe6514d414526404177821fcf669bfd95dabbf603e192f9a3f3"),
    ],
)
def test_followup_never_rewrites_historical_experiment(name: str, expected: str) -> None:
    assert hashlib.sha256((ROOT / name).read_bytes()).hexdigest() == expected
