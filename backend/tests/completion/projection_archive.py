"""Test-only reconciliation of immutable pre-145 evidence with the approved wire delta."""

import copy
import json

from wisp_backend.prompt_inspection.report import digest

REMOVED = ("synthesizedTone", "expression.pace", "expression.trust", "expression.attention", "expression.play")


def project_character(character: dict) -> dict:
    projected = copy.deepcopy(character)
    projected.pop("synthesizedTone")
    for name in ("pace", "trust", "attention", "play"):
        projected["expression"].pop(name)
    return projected


def projected_factual_messages(block: dict) -> list[dict]:
    messages = [dict(m) for m in block["messages"] if m["role"] != "system"]
    if block["key"] == "character_profile_state":
        for message in messages:
            lines = message["content"].splitlines()
            for path in REMOVED:
                assert sum(line.startswith(f"- {path}: ") for line in lines) == 1
            message["content"] = "\n".join(
                line for line in lines if not any(line.startswith(f"- {path}: ") for path in REMOVED)
            )
    return messages


def assert_projected_input(body: dict, old_digest: str, old_blocks: list[dict]) -> None:
    """Restore only the five removed values and require the original whole-input hash."""
    old_character = next((b for b in old_blocks if b["key"] == "character_profile_state"), None)
    if old_character is None:
        assert "character" not in body
        assert digest(body) == old_digest
        return
    original = {}
    for message in old_character["messages"]:
        if message["role"] == "system":
            continue
        for line in message["content"].splitlines()[1:]:
            path, value = line.removeprefix("- ").split(": ", 1)
            target = original
            keys = path.split(".")
            for key in keys[:-1]:
                target = target.setdefault(key, {})
            target[keys[-1]] = json.loads(value)
    assert body["character"] == project_character(original)
    restored = copy.deepcopy(body)
    restored["character"] = original
    assert digest(restored) == old_digest


def assert_selection_preserves_priority_and_history(before: dict, current: dict) -> None:
    """Smaller mandatory context may admit history ahead of lower-priority optionals."""
    blocks = {b["key"]: b for b in current["blocks"]}
    selected = set(current["selected_keys"])
    assert {key for key, b in blocks.items() if b["required"]} <= selected
    old_history = {key for key in before["selected_keys"] if key.startswith("history_")}
    history = sorted(int(key.split("_")[1]) for key in selected if key.startswith("history_"))
    assert old_history <= selected
    if history:
        total = sum(key.startswith("history_") for key in blocks)
        assert history == list(range(history[0], total))
    added = selected - set(before["selected_keys"])
    for removed in set(before["selected_keys"]) - selected:
        assert not blocks[removed]["required"]
        assert any(blocks[key]["priority"] > blocks[removed]["priority"] for key in added)
