"""Frozen #121 archive checks; current runtime no longer supports speech resources."""

import copy
import hashlib
import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).parents[1] / "fixtures/prompt_inspection"


def artifact() -> dict[str, Any]:
    return json.loads((ROOT / "issue121_comparison.json").read_text())


def test_resource_delta_is_only_four_approved_chat_records_and_revision() -> None:
    data = artifact()
    old, new = (copy.deepcopy(data["resource_changes"][stage]) for stage in ("before", "after"))
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
    assert (
        hashlib.sha256((ROOT / "issue121_legacy_resources.json").read_bytes()).hexdigest()
        == data["legacy_resources_sha256"]
    )
    assert data["quality"]["provider_calls"] == 0 and data["quality"]["status"] == "NOT RUN"


def test_archived_speech_delta_keeps_non_example_blocks_and_settings() -> None:
    data = artifact()
    assert len(data["records"]) == 32
    assert {row["case"]["locale"] for row in data["records"]} == {"ru", "en"}
    assert {row["case"]["provider"] for row in data["records"]} == {"openai", "gemini"}
    for row in data["records"]:
        old, new = row["before"], row["after"]
        assert old["non_example_blocks_sha256"] == new["non_example_blocks_sha256"]
        assert old["settings"] == new["settings"]
        for field in ("context_window", "output_reserve", "input_allowance", "required_estimate"):
            assert old["budget"][field] == new["budget"][field]
        for stage in (old, new):
            block = stage["example_block"]
            assert block["key"] == "examples" and block["source"] == "server_examples"
            assert block["roles"] == ["user"] and not block["required"]
            selected = "examples" in stage["selected_keys"]
            assert selected == block["decision"]["included"]
            assert selected is (row["case"]["budget_case"] != "required_only")
            assert stage["budget"]["selected_estimate"] <= stage["budget"]["input_allowance"]
