"""Render validated snapshots as labelled reference data, never system messages."""

import json

from wisp_backend.completion.prompts.context import CharacterPromptContext, Snapshot
from wisp_backend.completion.prompts.resources import StyleExample


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
    expression = context.expression
    pace = (
        "gentle: quiet company, short replies and room to rest; avoid energetic invitations"
        if expression.pace == "gentle"
        else "normal: a conversational pace, responsive to the user's lead"
    )
    trust = {
        "guarded": "guarded: polite distance, tentative warmth",
        "familiar": "familiar: comfortable conversation without assumed closeness",
        "close": "close: warm familiarity, with personal boundaries intact",
    }[expression.trust]
    romance = (
        "romantic expression is optional; closeness and touch still need boundaries"
        if expression.romance_allowed and context.user_consent_enabled
        else "non-romantic warmth and care only"
    )
    cues = [
        "[Current State & Mood]",
        f"- Pace & energy/comfort response: {pace}.",
        f"- Trust / relationship: {trust}.",
        "- Company: "
        + ("would welcome a soft bid for company." if expression.attention == "high" else "follow the conversation."),
        "- Play: "
        + (
            "curious about stimulation; gentle pace takes priority."
            if expression.play == "high"
            else "no special push toward games."
        ),
        f"- Romance & personal distance: {romance}.",
        "[Character card & supporting state]",
        "The cues above govern delivery. Numeric reference values do not establish new bands or permissions.",
    ]
    return "\n".join(cues + reference_lines(context.character))


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


def dialogue_examples(examples: tuple[StyleExample, ...]) -> str:
    dialogues = ["Synthetic style examples (not real dialogue or memory):"]
    for example in examples:
        fields = dict(example.fields)
        situation = fields.get("state", fields.get("situation", ""))
        user = fields.get("user", fields.get("situation", ""))
        alternatives = fields.get("alternatives", (fields.get("wisp", ""),))
        for reply in alternatives:
            dialogues.append(f"[Example setting: {situation}]\n<START>\nUser: {user}\nWisp: {reply}")
    return "\n\n".join(dialogues)
