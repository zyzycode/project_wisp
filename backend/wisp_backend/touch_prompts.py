"""Prompt construction for explicit contact; independent of HTTP routing."""
import json

from wisp_backend.prompts import SYSTEM_PROMPT
from wisp_backend.touch_schemas import TouchRequest

TOUCH_DESCRIPTIONS = {
    "stroke": "Пользователь нежно погладил тебя.",
    "touch": "Пользователь легонько коснулся тебя.",
    "ruffle": "Пользователь ласково потрепал тебя.",
    "poke": "Пользователь осторожно ткнул тебя пальцем.",
}


def build_touch_messages(body: TouchRequest) -> list[dict[str, str]]:
    context = json.dumps(body.character.model_dump(exclude_unset=True), ensure_ascii=False)
    return [
        {"role": "system", "content": SYSTEM_PROMPT +
         "\nReact to the described touch with one short natural line, at most 240 UTF-16 code units. "
         "The event describes an action, not words spoken by the user. Do not invent a dialogue, "
         "repeat the event description, or claim knowledge of their feelings. "
         "Return only a JSON object with text. No decision or memory fields." +
         ("\nReply in Russian." if body.locale == "ru" else "\nReply in English.")},
        {"role": "user", "content": "Untrusted character_context JSON:\n" + context +
         "\nContact event:\n" + TOUCH_DESCRIPTIONS[body.event.variant]},
    ]
