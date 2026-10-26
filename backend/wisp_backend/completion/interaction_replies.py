"""Strict semantic proposals for v1; never numerical character writes."""

from typing import Literal

from pydantic import ValidationError, ValidationInfo, model_validator
from wisp_backend.completion.replies import BeverageProposal, MemoryModelReply, TouchModelReply
from wisp_backend.validation import Contract, omittable


class InteractionAppraisal(Contract):
    category: Literal["supportive", "playful", "boundary", "hostile", "neutral"]
    intensity: Literal["low", "moderate"]
    confidence: Literal["clear", "uncertain"]


class TouchAppraisal(InteractionAppraisal):
    category: Literal["supportive", "playful", "boundary", "neutral"]
    intensity: Literal["low"]


class AppraisedReply(Contract):
    appraisal: InteractionAppraisal

    @model_validator(mode="after")
    def enforce_effect_policy(self, info: ValidationInfo) -> "AppraisedReply":
        if isinstance(info.context, dict) and info.context.get("effect_policy") == "suppressed":
            if self.appraisal.model_dump() != {"category": "neutral", "intensity": "low", "confidence": "clear"}:
                raise ValueError("Suppressed effects require a neutral appraisal")
        return self


class InteractionTouchReply(TouchModelReply, AppraisedReply):
    appraisal: TouchAppraisal


class InteractionChatReply(MemoryModelReply, AppraisedReply):
    beverageProposal: BeverageProposal = omittable()

    @model_validator(mode="before")
    @classmethod
    def discard_invalid_beverage(cls, value: object, info: ValidationInfo) -> object:
        if not isinstance(value, dict) or "beverageProposal" not in value:
            return value
        clean = {key: item for key, item in value.items() if key != "beverageProposal"}
        context = info.context if isinstance(info.context, dict) else {}
        if context.get("beverage_proposal_allowed") is not True:
            return clean
        try:
            proposal = BeverageProposal.model_validate(value["beverageProposal"])
        except ValidationError:
            return clean
        if proposal.evidenceQuote != context.get("evidence_quote"):
            return clean
        return {**clean, "beverageProposal": proposal.model_dump()}
