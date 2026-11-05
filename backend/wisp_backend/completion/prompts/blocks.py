"""Required technical instructions and factual snapshots, without speech resources."""

import json

from wisp_backend.completion.context import ContextBlock, ContextMessage
from wisp_backend.completion.prompts.context import CharacterPromptContext, Snapshot
from wisp_backend.completion.prompts.narrative import character_state, recalled_memory
from wisp_backend.completion.prompts.technical import CHARACTER_RULES


def common_blocks(
    context: CharacterPromptContext,
    instructions: str,
    *,
    memory: Snapshot | None = None,
    additional_instructions: str = "",
) -> list[ContextBlock]:
    language = "\nReply in Russian." if context.locale == "ru" else "\nReply in English."
    blocks = [
        ContextBlock(
            "instructions",
            "server_instructions",
            True,
            1000,
            0,
            (ContextMessage("system", instructions + CHARACTER_RULES + language + additional_instructions),),
        ),
        ContextBlock(
            "character_profile_state",
            "desktop_character",
            True,
            1000,
            10,
            (ContextMessage("user", character_state(context)),),
        ),
    ]
    expression = context.character.get("expression")
    causal = expression.get("causal") if isinstance(expression, dict) else None
    if causal is not None:
        blocks.append(
            ContextBlock(
                "causal_expression",
                "desktop_character",
                True,
                1000,
                12,
                (
                    ContextMessage(
                        "user", "Current desktop causal decision:\n" + json.dumps(causal, ensure_ascii=False)
                    ),
                ),
                server_instructions=(
                    "The desktop already chose this current causal intent and emotion. Formulate that decision "
                    "using the character card; do not replace it with a different emotion, invent a hidden user "
                    "motive, change state, or execute an action. Deferred invitation is only a pending local record, "
                    "not a promise of execution. Own game interest is a source-validated character inference, "
                    "not a user preference or permission. Response hints do not override the local decision."
                ),
            )
        )
    if memory is not None:
        # Desktop selected this projection. Preserve corrected facts atomically.
        blocks.append(
            ContextBlock(
                "memory",
                "desktop_memory",
                True,
                1000,
                20,
                (ContextMessage("user", recalled_memory(memory)),),
            )
        )
    return blocks
