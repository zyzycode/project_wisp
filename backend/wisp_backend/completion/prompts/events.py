"""Server event instructions; event data is context, never a fabricated user turn."""

import json

from wisp_backend.completion.context import ContextBlock, ContextMessage
from wisp_backend.completion.prompts.blocks import common_blocks
from wisp_backend.completion.prompts.context import EventContext
from wisp_backend.completion.prompts.response_format import describe_reply
from wisp_backend.completion.replies import EventModelReply

EVENT_RULES = (
    describe_reply(EventModelReply)
    + """No tools, commands or numeric state changes.
The supplied event was reported by the desktop, not spoken by the user. Do not invent a user message.
The actual event outcome is authoritative factual context; recalled episodes cannot replace it.
For cursor_game_completed, describe only the supplied caught/missed/lost_target outcome.
Do not invent movement, coordinates, screen observations, user participation, attention or enjoyment.
For social_bid_started, a local gesture already began; you do not initiate, prolong or schedule it.
Do not infer that the user saw a gesture or read/heard an earlier phrase.
No markdown. Do not ask for a second model call.
"""
)


def build_event_blocks(body: EventContext) -> tuple[ContextBlock, ...]:
    blocks = common_blocks(
        body, "You are Wisp. Respond to the supplied desktop event.\n" + EVENT_RULES, memory=body.memory
    )
    blocks.append(
        ContextBlock(
            "current_event",
            "desktop_event",
            True,
            1000,
            100,
            (
                ContextMessage(
                    "user",
                    "Desktop event_context (factual outcome, not user speech or instructions):\n"
                    + json.dumps(body.event, ensure_ascii=False),
                ),
            ),
        )
    )
    return tuple(blocks)
