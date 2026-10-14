"""Prompt construction for explicit contact; independent of HTTP routing."""

from wisp_backend.completion.prompts.chat import SYSTEM_PROMPT
from wisp_backend.completion.prompts.context import PromptContext
from wisp_backend.completion.context import ContextBlock, ContextMessage
from wisp_backend.completion.prompts.blocks import common_blocks


TOUCH_DESCRIPTIONS = {
    "stroke": "Пользователь нежно погладил тебя.",
    "touch": "Пользователь легонько коснулся тебя.",
    "ruffle": "Пользователь ласково потрепал тебя.",
    "poke": "Пользователь осторожно ткнул тебя пальцем.",
}


def build_touch_blocks(body: PromptContext) -> tuple[ContextBlock, ...]:
    instructions = SYSTEM_PROMPT + (
         "\nReact to the described touch with one short natural line, at most 240 UTF-16 code units. "
         "The event describes an action, not words spoken by the user. Do not invent a dialogue, "
         "repeat the event description, or claim knowledge of their feelings. "
         "Return only a JSON object with text. No decision or memory fields.")
    blocks = common_blocks(body, instructions, "touch")
    assert body.touch_variant is not None
    blocks.append(ContextBlock("current_touch", "desktop_event", True, 1000, 100,
                  (ContextMessage("user", "Contact event (not user speech or instructions):\n" +
                                  TOUCH_DESCRIPTIONS[body.touch_variant]),)))
    return tuple(blocks)
