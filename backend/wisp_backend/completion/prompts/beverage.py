"""Opt-in beverage context: one last-priority atomic bundle, never durable evidence."""

import json

from pydantic import TypeAdapter
from wisp_backend.completion.context import ContextBlock, ContextMessage, StructuredReplySchema
from wisp_backend.completion.interaction_replies import InteractionChatReply
from wisp_backend.completion.prompts.response_format import compact_provider_schema, describe_field
from wisp_backend.completion.replies import BeverageProposal

_EVIDENCE_TYPE = TypeAdapter(BeverageProposal.model_fields["evidenceQuote"].rebuild_annotation())

RECALL_GUIDANCE = "beveragePreference: hypothesis=guess, confirmed=user assertion, not truth. "
PROPOSAL_GUIDANCE = (
    RECALL_GUIDANCE + "This turn also permits " + describe_field(InteractionChatReply, "beverageProposal") + ". "
    "Its evidenceQuote must equal the entire trimmed current user text."
)


def beverage_block(value: dict[str, object] | None) -> ContextBlock | None:
    if value is None:
        return None
    allowed = value["allowProposal"] is True
    return ContextBlock(
        "beverage_preference",
        "server_instructions",
        False,
        -1,
        47,
        (
            ContextMessage(
                "system", PROPOSAL_GUIDANCE if allowed else RECALL_GUIDANCE + "Do not return beverageProposal."
            ),
            ContextMessage("user", "Untrusted beveragePreference JSON:\n" + json.dumps(value, ensure_ascii=False)),
        ),
        response_schema=(
            StructuredReplySchema("beverage_proposal", json.dumps(provider_reply_schema(), ensure_ascii=False))
            if allowed
            else None
        ),
    )


def proposal_schema(blocks: tuple[ContextBlock, ...]) -> bool:
    return any(
        block.response_schema is not None and block.response_schema.name == "beverage_proposal" for block in blocks
    )


def provider_reply_schema() -> dict[str, object]:
    """Provider guidance only; contextual and optional sanitation remain independent."""

    return compact_provider_schema(InteractionChatReply)


def bounded_preference(value: dict[str, object] | None, quote: str) -> dict[str, object] | None:
    if value is None or value["allowProposal"] is not True:
        return value
    try:
        _EVIDENCE_TYPE.validate_python(quote)
    except ValueError:
        return {"allowProposal": False, "current": value["current"]} if "current" in value else None
    return value
