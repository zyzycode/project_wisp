"""Required technical instructions and factual snapshots, without speech resources."""

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
