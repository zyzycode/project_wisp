"""Author resources are strict immutable data, independent of wire and user input."""

import json
from copy import deepcopy
from dataclasses import FrozenInstanceError
from typing import Any

import pytest
from pydantic import ValidationError
from wisp_backend.completion.prompts import blocks, selection
from wisp_backend.completion.prompts.context import ExpressionContext, InteractionContext, InteractionTouchContext
from wisp_backend.completion.prompts.resources import RESOURCE_PATH, get_prompt_resources, parse_resources
from wisp_backend.prompt_inspection.report import inspect_scene


def document() -> dict[str, Any]:
    return json.loads(RESOURCE_PATH.read_text(encoding="utf-8"))


def encode(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False).encode("utf-8")


@pytest.mark.parametrize(
    ("path", "value"),
    [
        (("format",), True),
        (("format",), "1"),
        (("format",), 2),
        (("revision",), ""),
        (("revision",), "я"),
        (("revision",), "a" * 65),
        (("texts", "chat_intro"), None),
        (("texts", "chat_intro"), 5),
        (("texts", "chat_intro"), " \n\t"),
        (("texts", "chat_intro"), "bad\x00control"),
        (("texts", "chat_intro"), "😀" * 6001),
        (("texts", "unknown"), "text"),
        (("unknown",), "text"),
        (("examples", "fr"), {}),
        (("examples", "en", "chat"), None),
        (("examples", "en", "chat", 0, "alternatives"), ["a", "b", "c"]),
        (("examples", "en", "chat", 0, "alternatives"), []),
        (("examples", "en", "chat", 0, "alternatives"), [None]),
        (("examples", "en", "chat", 0, "role"), "system"),
    ],
)
def test_resource_rejects_invalid_values_and_unknown_fields(path: tuple[str | int, ...], value: object) -> None:
    raw = document()
    target = raw
    for key in path[:-1]:
        target = target[key]
    target[path[-1]] = value
    with pytest.raises(ValueError):
        parse_resources(encode(raw))


@pytest.mark.parametrize("section", ["texts", "locale", "scenario"])
def test_required_fragment_locale_and_scenario_cannot_be_missing(section: str) -> None:
    raw = document()
    if section == "texts":
        del raw["texts"]["variation"]
    elif section == "locale":
        del raw["examples"]["ru"]
    else:
        del raw["examples"]["en"]["touch"]
    with pytest.raises(ValueError):
        parse_resources(encode(raw))


def test_total_example_size_count_and_duplicate_ids_are_bounded() -> None:
    raw = document()
    raw["examples"]["en"]["chat"][0].update(state="a" * 600, user="b" * 600)
    with pytest.raises(ValueError, match="Example text limit"):
        parse_resources(encode(raw))
    raw = document()
    entry = raw["examples"]["en"]["chat"][0]
    entry["id"] = raw["examples"]["ru"]["chat"][0]["id"]
    with pytest.raises(ValueError, match="Duplicate example ID"):
        parse_resources(encode(raw))
    raw = document()
    entry = raw["examples"]["en"]["event"][0]
    raw["examples"]["en"]["event"] = [dict(entry, id=f"extra-{index}") for index in range(32)]
    with pytest.raises(ValueError, match="Example count limit"):
        parse_resources(encode(raw))


@pytest.mark.parametrize("raw", [b'{"format":1,"format":1}', b"{", b"\xff", b" " * (64 * 1024 + 1)])
def test_duplicate_json_keys_malformed_utf8_and_oversize_bytes_are_rejected(raw: bytes) -> None:
    with pytest.raises(ValueError):
        parse_resources(raw)


def test_resources_preserve_whitespace_and_are_deeply_immutable() -> None:
    raw = document()
    raw["texts"]["chat_intro"] = " \n\tSynthetic editable intro. \n"
    parsed = parse_resources(encode(raw))
    assert parsed.texts.chat_intro == raw["texts"]["chat_intro"]
    with pytest.raises(FrozenInstanceError):
        parsed.revision = "other"
    with pytest.raises(ValidationError):
        parsed.texts.chat_intro = "changed"
    with pytest.raises(FrozenInstanceError):
        parsed.examples[0].fields = ()
    payloads = [entry.payload() for entry in parsed.examples if entry.locale == "ru" and entry.scenario == "chat"]
    original = deepcopy(payloads)
    payloads[0]["alternatives"][0] = "changed"
    assert [
        entry.payload() for entry in parsed.examples if entry.locale == "ru" and entry.scenario == "chat"
    ] == original
    assert "id" not in payloads[0]


def test_empty_example_list_produces_no_optional_block(monkeypatch: pytest.MonkeyPatch) -> None:
    raw = document()
    raw["examples"]["en"]["touch"] = []
    parsed = parse_resources(encode(raw))
    monkeypatch.setattr(selection, "get_prompt_resources", lambda: parsed)
    context = InteractionTouchContext(
        "en",
        {},
        InteractionContext({}, "suppressed"),
        expression=ExpressionContext("gentle", "guarded", "ordinary", "ordinary", False),
        user_consent_enabled=False,
    )
    assert "examples" not in {block.key for block in blocks.common_blocks(context, "Fixed rules", "touch")}


def test_inspector_identifies_the_installed_resource_snapshot() -> None:
    import asyncio

    report = asyncio.run(inspect_scene("tired"))
    resources = get_prompt_resources()
    assert report["resources"] == {"revision": resources.revision, "sha256": resources.sha256}
