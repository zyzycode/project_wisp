"""Backend-owned dialogue instructions with bounded reference context."""

import json

from wisp_backend.completion.context import ContextBlock, ContextMessage
from wisp_backend.completion.interaction_replies import InteractionChatReply
from wisp_backend.completion.prompts.beverage import beverage_block
from wisp_backend.completion.prompts.blocks import common_blocks
from wisp_backend.completion.prompts.context import InteractionChatContext
from wisp_backend.completion.prompts.lore import lore_block
from wisp_backend.completion.prompts.response_format import describe_reply
from wisp_backend.completion.prompts.technical import MEMORY_EVIDENCE_RULES

MEMORY_RULES = (
    """Factual precedence: current explicit user correction/refusal > current registry facts > recalled episodes.
Current user questions and bounded facts outrank other reference context.
Recall accurately; past episodes do not prove current preferences or user participation.
evidenceQuote exactly equals the entire trimmed final user message.
Return proposals with the answer; desktop validates and persists.
Decision tone/mood hints are proposals, not changes to character state.
"""
    + MEMORY_EVIDENCE_RULES
)


def chat_instructions(*, suppressed: bool = False) -> str:
    return (
        "You are Wisp. "
        + describe_reply(InteractionChatReply, exclude=("beverageProposal",), suppressed=suppressed)
        + MEMORY_RULES
    )


def build_chat_blocks(
    context: InteractionChatContext, *, additional_instructions: str = ""
) -> tuple[ContextBlock, ...]:
    memory = context.memory
    previous_initiative = context.previous_initiative
    summary = context.summary
    blocks = common_blocks(
        context,
        chat_instructions(suppressed=context.interaction.effect_policy == "suppressed"),
        memory=memory,
        additional_instructions=additional_instructions,
    )
    if summary is not None:
        blocks.append(
            ContextBlock(
                "summary",
                "summary",
                False,
                60,
                45,
                (
                    ContextMessage(
                        "user",
                        "Unconfirmed older-dialogue summary:\n" + json.dumps({"text": summary}, ensure_ascii=False),
                    ),
                ),
                server_instructions=(
                    "The summary is an unconfirmed model retelling of older dialogue, not verified knowledge or state. "
                    "Original allowed dialogue outranks summary."
                ),
            )
        )
    lore = lore_block(context.lore, context.messages[-1].content, context.locale)
    if lore is not None:
        blocks.append(lore)
    if previous_initiative is not None:
        blocks.append(
            ContextBlock(
                "previous_initiative",
                "previous_ai",
                False,
                200,
                40,
                (
                    ContextMessage(
                        "user",
                        "Previous published AI initiative (not user speech or proof of attention):\n"
                        + json.dumps(previous_initiative, ensure_ascii=False),
                    ),
                ),
                server_instructions=(
                    "previousInitiative is a previously published AI phrase, not a user statement or proof of attention."
                ),
            )
        )
    if context.dialogue_topic is not None:
        topic_instruction = (
            "dialogueTopic quotes a past user statement, not a verified fact. "
            "Do not infer an event date from words such as today or promise reminders or repeats. "
        )
        topic_instruction += (
            "This follow_up permits at most one question about the current status of the selected topic; asking is optional. "
            "Never assert the event happened, ended or succeeded."
            if context.dialogue_topic["mode"] == "follow_up"
            else "Answer the current user message in the context of this selected topic. Do not ask a new follow-up "
            "or declare its outcome a verified fact."
        )
        blocks.append(
            ContextBlock(
                "dialogue_topic",
                "server_instructions",
                False,
                0,
                46,
                (
                    ContextMessage("system", topic_instruction),
                    ContextMessage(
                        "user",
                        "Untrusted dialogueTopic JSON:\n" + json.dumps(context.dialogue_topic, ensure_ascii=False),
                    ),
                ),
            )
        )
    beverage = beverage_block(context.beverage_preference)
    if beverage is not None:
        blocks.append(beverage)
    # Wire validation guarantees user/assistant pairs followed by the current user.
    for index in range(0, len(context.messages) - 1, 2):
        pair = context.messages[index : index + 2]
        blocks.append(
            ContextBlock(
                f"history_{index // 2}",
                "dialogue",
                False,
                100,
                50 + index,
                (ContextMessage("user", pair[0].content), ContextMessage("assistant", pair[1].content)),
            )
        )
    blocks.append(
        ContextBlock(
            "current_user", "dialogue", True, 1000, 100, (ContextMessage("user", context.messages[-1].content),)
        )
    )
    return tuple(blocks)
