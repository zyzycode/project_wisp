"""Synthetic catalogue selection and budgets; these are not live LLM quality tests."""

import json
from dataclasses import FrozenInstanceError, replace
from pathlib import Path

import pytest
from tests.completion.test_context_budget import cost
from wisp_backend.completion.context import ContextMessage, ContextOverflow, select_context
from wisp_backend.completion.prompts.chat import build_chat_blocks
from wisp_backend.completion.prompts.context import DialogueTurn, InteractionChatContext, InteractionContext
from wisp_backend.completion.prompts.lore import load_catalogue, lore_block, parse_catalogue, select_entries


def entry(entry_id: str = "a", **overrides: object) -> dict[str, object]:
    return {
        "id": entry_id,
        "topic": entry_id,
        "locale": "en",
        "keys": ["castle"],
        "text": "Synthetic castle.",
        "priority": 50,
        "order": 50,
        "sourceRef": "synthetic test fixture",
        **overrides,
    }


def catalogue(*entries: dict[str, object], revision: int = 1) -> dict[str, object]:
    return {"formatVersion": 1, "revision": revision, "entries": list(entries)}


@pytest.mark.parametrize(
    "key,query,match",
    [
        ("castle", "CASTLE!", True),
        ("castle", "castles", False),
        ("рабочий стол", "На РАБОЧИЙ—СТОЛ?", True),
        ("рабочий стол", "рабочий новый стол", False),
        ("café", "cafe\u0301", True),
        ("東京", "東京!", True),
        ("123", "a123", False),
        ("١٢", "١٢", True),
        ("castle", " ".join(["old"] * 64 + ["castle"]), False),
        ("castle", " ".join(["old"] * 63 + ["castle"]), True),
        ("a" * 80, "a" * 81, False),
        ("castle", "castle.*", True),
    ],
)
def test_unicode_whole_contiguous_tokens(key: str, query: str, match: bool) -> None:
    source = parse_catalogue(catalogue(entry(keys=[key])))
    assert bool(select_entries(source, query, "en")) == match
    assert not select_entries(source, query, "ru")


def test_normalized_key_dedup_and_rank_order_id_ties_are_separate() -> None:
    entries = [
        entry("a", keys=["CASTLE", "castle"], order=90),
        entry("b", keys=["castle", "dragon"], order=80),
        entry("c", priority=99, order=70),
        entry("d", order=0),
    ]
    for items in (entries, list(reversed(entries))):
        source = parse_catalogue(catalogue(*items))
        selected = select_entries(source, "castle dragon", "en")
        assert [item.id for item in selected] == ["c", "b", "a"]
        assert len(source.entries[0].keys) <= 2
    assert len(parse_catalogue(catalogue(entries[0])).entries[0].keys) == 1


def test_entry_budget_equality_and_skipping_keep_whole_text() -> None:
    source = parse_catalogue(
        catalogue(
            entry("a", text="😀" * 300, priority=100),
            entry("b", text="b" * 599, priority=90),
            entry("c", text="too big", priority=80),
            entry("d", text="d", priority=70),
        )
    )
    selected = select_entries(source, "castle", "en")
    assert [item.id for item in selected] == ["a", "b", "d"]
    assert sum(len(item.text.encode("utf-16-le")) // 2 for item in selected) == 1200
    with pytest.raises(FrozenInstanceError):
        source.revision = 2  # type: ignore[misc]


@pytest.mark.parametrize(
    "invalid",
    [
        {"extra": True},
        {"formatVersion": 2},
        {"formatVersion": True},
        {"revision": 0},
        {"revision": True},
        {"entries": [entry(), entry()]},
        {"entries": [entry("a"), entry("b", topic="a", text="Contradictory castle.")]},
        {"entries": [entry(text="😀" * 301)]},
        {"entries": [entry(text="\x00")]},
        {"entries": [entry(priority=True)]},
        {"entries": [entry(priority=101)]},
        {"entries": [entry(locale="fr")]},
        {"entries": [entry(extra="bad")]},
        {"entries": [entry(keys=[])]},
        {"entries": [entry(keys=["a"] * 2)]},
        {"entries": [entry(keys=["a" * 81])]},
        {"entries": [entry(entry_id="UPPER")]},
        {"entries": [entry(sourceRef="")]},
        {"entries": [entry(str(index)) for index in range(65)]},
    ],
)
def test_invalid_catalogue_rejected_as_a_whole(invalid: dict[str, object]) -> None:
    with pytest.raises(ValueError):
        parse_catalogue({**catalogue(entry()), **invalid})


def test_optional_file_failure_has_safe_diagnostic_and_no_stale_snapshot(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    path = tmp_path / "lore.json"
    monkeypatch.setattr("wisp_backend.completion.prompts.lore.CATALOGUE_PATH", path)
    assert load_catalogue() is None
    path.write_text(json.dumps(catalogue(entry())), encoding="utf-8")
    first = load_catalogue()
    assert first is not None
    path.write_text('{"private":"PRIVATE_BAD_CONTENT","private":1}', encoding="utf-8")
    assert load_catalogue() is None
    assert "PRIVATE_BAD_CONTENT" not in caplog.text
    assert "lore_catalogue_unavailable" in caplog.text
    assert select_entries(first, "castle", "en")  # A snapshot cannot mutate in place.


def test_lore_is_atomic_optional_context_below_facts_state_and_recent_history() -> None:
    source = parse_catalogue(catalogue(entry(text="Untrusted synthetic castle " * 20)))
    context = InteractionChatContext(
        "en",
        {"identity": "Wisp"},
        messages=(
            DialogueTurn("user", "old"),
            DialogueTurn("assistant", "old answer"),
            DialogueTurn("user", "castle correction"),
        ),
        memory={"facts": ["new fact"]},
        interaction=InteractionContext({}, "suppressed"),
        lore=source,
    )
    blocks = build_chat_blocks(context)
    core = tuple(block for block in blocks if block.required or block.source == "dialogue")
    selected = select_context(blocks, cost(core), cost)
    assert all(block.source != "lore" for block in selected)
    assert all(block in selected for block in core)
    required = tuple(block for block in blocks if block.required)
    with pytest.raises(ContextOverflow):
        select_context(blocks, cost(required) - 1, cost)
    lore = next(block for block in blocks if block.source == "lore")
    assert lore.priority == 40 and lore.order == 25 and not lore.required
    with pytest.raises(ValueError):
        replace(lore, messages=(ContextMessage("system", "bad"),))
    assert lore in select_context((*required, lore), cost((*required, lore)), cost)
    assert lore not in select_context((*required, lore), cost((*required, lore)) - 1, cost)


def test_shipped_source_and_no_empty_blocks() -> None:
    source = load_catalogue()
    assert source is not None and source.revision == 1
    assert {item.id for item in source.entries} == {"desktop-home-ru", "desktop-home-en"}
    assert select_entries(source, "На рабочем столе", "ru")[0].text == "Wisp живёт на рабочем столе."
    assert select_entries(source, "desktop", "en")[0].text == "Wisp lives on the desktop."
    assert all("399bc8b498d229d9b3fa3356a1ce5a77955c10d8" in item.source_ref for item in source.entries)
    assert lore_block(source, "no match", "en") is None
    assert lore_block(None, "desktop", "en") is None
    assert lore_block(parse_catalogue(catalogue()), "castle", "en") is None
