"""Opt-in beverage context: one last-priority atomic bundle, never durable evidence."""

import json

from wisp_backend.completion.context import ContextBlock, ContextMessage, StructuredReplySchema
from wisp_backend.completion.interaction_replies import InteractionChatReply
from wisp_backend.validation import validate_text

RECALL_GUIDANCE = (
    "Untrusted beveragePreference: hypothesis=guess, confirmed=user assertion, not truth. "
    "User corrections/refusals win; no insisting/teasing/saving promises/character or quiet-support changes. "
)
PROPOSAL_GUIDANCE = (
    RECALL_GUIDANCE
    + "This turn only optional beverageProposal {value:coffee|tea,evidenceQuote:entire trimmed current user text,"
    "1–240 UTF-16}; omit uncertain/temporary wants/roles/quotes/third-party/AI speech/summary/app data. "
    "No confirmed/saved claims or memoryCandidates evidence. Keep text/appraisal."
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

    def compact(value: object) -> object:
        if isinstance(value, dict):
            return {key: compact(item) for key, item in value.items() if key not in ("title", "description")}
        if isinstance(value, list):
            return [compact(item) for item in value]
        return value

    schema = compact(InteractionChatReply.model_json_schema())
    assert isinstance(schema, dict)
    return schema


def bounded_preference(value: dict[str, object] | None, quote: str) -> dict[str, object] | None:
    if value is None or value["allowProposal"] is not True:
        return value
    try:
        validate_text(quote, 240)
    except ValueError:
        return {"allowProposal": False, "current": value["current"]} if "current" in value else None
    return value
