"""Lossless historical payload evidence and current card-only prompt measurements."""

import asyncio
import copy
import hashlib
import json
from pathlib import Path

import httpx
import pytest
from wisp_backend.prompt_inspection.report import digest, encoded, inspect_scene, source_digests
from wisp_backend.prompt_inspection.scenes import SCENES_PATH

ARTIFACT = Path(__file__).parents[1] / "fixtures/prompt_inspection/issue137_comparison.json"


def thaw(value: object, pool: dict[str, str]) -> object:
    if isinstance(value, dict):
        if set(value) == {"$text"}:
            text = pool[value["$text"]]
            assert hashlib.sha256(text.encode()).hexdigest() == value["$text"]
            return text
        return {key: thaw(item, pool) for key, item in value.items()}
    if isinstance(value, list):
        return [thaw(item, pool) for item in value]
    return value


def test_before_evidence_is_lossless_and_inputs_change_only_by_the_approved_card_delta() -> None:
    data = json.loads(ARTIFACT.read_bytes())
    assert data["synthetic"] is True and data["before_source_commit"] == "5983fb14bf0be6e77f00bec628431ee90d0a0c53"
    assert data["live_quality"] == {"status": "NOT RUN", "provider_calls": 0}
    corpus = thaw(data["before_input_corpus"], data["text_pool"])
    assert (
        hashlib.sha256((json.dumps(corpus, ensure_ascii=False, indent=2) + "\n").encode()).hexdigest()
        == data["before_input_corpus_sha256"]
    )
    current = json.loads(SCENES_PATH.read_bytes())
    delta = data["card_delta"]
    for name, variants in corpus["scenes"].items():
        for locale, original in variants.items():
            expected = copy.deepcopy(original)
            expected["body"]["character"]["personality"]["aiSelfConcept"] += delta["append_ai_self_concept"]
            if "card" in expected["body"]:
                assert expected["body"]["card"]["revision"] == delta["before_revision"]
                expected["body"]["card"]["revision"] = delta["after_revision"]
            assert current["scenes"][name][locale] == expected
    assert len(data["rows"]) == 120
    for row in data["rows"]:
        messages = thaw(row["before_messages"], data["text_pool"])
        payload = thaw(row["before_payload"], data["text_pool"])
        assert digest(messages) == row["before"]["messages_sha256"]
        assert digest(payload) == row["before"]["payload_sha256"]
        assert len(encoded(payload)) == row["before"]["payload_utf8_bytes"]
        if row["case"]["provider"] == "openai":
            assert payload["messages"] == messages
        else:
            assert payload["systemInstruction"]["parts"] == [
                {"text": message["content"]} for message in messages if message["role"] == "system"
            ]


def test_current_runtime_reproduces_after_and_preserves_budget_history_and_source_facts(monkeypatch) -> None:
    data = json.loads(ARTIFACT.read_bytes())

    async def forbidden(*args, **kwargs):
        pytest.fail("Prompt comparison cannot use HTTP")

    monkeypatch.setattr(httpx.AsyncClient, "send", forbidden)
    assert source_digests() == data["after_source_digests"]

    async def run():
        for row in data["rows"]:
            report = await inspect_scene(**row["case"])
            after = row["after"]
            for key in (
                "settings",
                "status",
                "measurement",
                "budget",
                "selected_keys",
                "payload_sha256",
                "messages_sha256",
                "payload_utf8_bytes",
                "blocks",
            ):
                assert report[key] == after[key]
            assert after["settings"] == row["before"]["settings"]
            for key in ("context_window", "output_reserve", "input_allowance"):
                assert after["budget"][key] == row["before"]["budget"][key]
            assert after["system_utf16_units"] < row["before"]["system_utf16_units"]
            assert after["selected_history_pairs"] >= row["before"]["selected_history_pairs"]
            assert after["budget"]["selected_estimate"] <= after["budget"]["input_allowance"]
            before_blocks = {block["key"]: block for block in row["before"]["blocks"]}
            after_blocks = {block["key"]: block for block in after["blocks"]}
            assert set(row["removed_blocks"]) == before_blocks.keys() - after_blocks.keys()
            assert all(key == "examples" or key.startswith("guidance_") for key in row["removed_blocks"])
            assert not any(block["source"] == "server_examples" for block in after["blocks"])
            for key in before_blocks.keys() & after_blocks.keys():
                if key not in {"instructions", "character_profile_state", "interaction_policy"}:
                    assert after_blocks[key]["messages_sha256"] == before_blocks[key]["messages_sha256"]
            selected_history = [int(key.split("_")[1]) for key in after["selected_keys"] if key.startswith("history_")]
            all_history = [key for key in after_blocks if key.startswith("history_")]
            if selected_history:
                assert selected_history == list(range(selected_history[0], len(all_history)))
            assert report["measurement"]["generation"] == "NOT RUN"

    asyncio.run(run())
