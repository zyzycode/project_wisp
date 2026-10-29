"""Render validated snapshots as labelled reference data, never system messages."""

import json

from wisp_backend.completion.prompts.context import CharacterPromptContext, Snapshot


def reference_lines(value: object, path: str = "") -> list[str]:
    """Keep every supplied leaf and escape newlines in quoted reference values."""
    if isinstance(value, dict) and value:
        return [line for key, item in value.items() for line in reference_lines(item, f"{path}.{key}" if path else key)]
    if isinstance(value, list) and value:
        return [line for index, item in enumerate(value) for line in reference_lines(item, f"{path}[{index}]")]
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    return [f"- {path}: {json.dumps(value, ensure_ascii=False)}"]


def character_state(context: CharacterPromptContext) -> str:
    return "\n".join(["[Character card & current factual state]", *reference_lines(context.character)])


def recalled_memory(memory: Snapshot) -> str:
    lines = ["[Known facts about User]"]
    facts = memory.get("facts", [])
    labels = {
        "user.display_name": "Name",
        "user.preferred_address": "Preferred form of address",
        "user.favorite_topic": "Favorite topic",
        "user.reply_style": "Preferred reply length",
        "user.cursor_game": "Attitude toward cursor games",
    }
    if isinstance(facts, list):
        for fact in facts:
            if isinstance(fact, dict):
                key = str(fact["key"])
                lines.append(f"- {labels.get(key, key)}: {json.dumps(fact['value'], ensure_ascii=False)}")
    if not facts:
        lines.append("- No recalled user facts supplied.")
    for key, title in (
        ("episodes", "Recalled episodes — past events, not current preferences"),
        ("characterPreferences", "Learned character preferences — not user facts"),
    ):
        lines.extend([f"[{title}]", *reference_lines(memory.get(key, []), key)])
    return "\n".join(lines)
