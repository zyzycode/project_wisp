"""Strict semantic proposals for v7; never numerical character writes."""
from typing import Literal

from pydantic import ValidationInfo, model_validator

from wisp_backend.completion.replies import MemoryModelReply, TouchModelReply
from wisp_backend.validation import Contract


class InteractionAppraisal(Contract):
    category: Literal['supportive', 'playful', 'boundary', 'hostile', 'neutral']
    intensity: Literal['low', 'moderate']
    confidence: Literal['clear', 'uncertain']


class TouchAppraisal(InteractionAppraisal):
    category: Literal['supportive', 'playful', 'boundary', 'neutral']
    intensity: Literal['low']


class AppraisedReply(Contract):
    appraisal: InteractionAppraisal

    @model_validator(mode='after')
    def enforce_effect_policy(self, info: ValidationInfo) -> 'AppraisedReply':
        if isinstance(info.context, dict) and info.context.get('effect_policy') == 'suppressed':
            if self.appraisal.model_dump() != {'category': 'neutral', 'intensity': 'low', 'confidence': 'clear'}:
                raise ValueError('Suppressed effects require a neutral appraisal')
        return self


class InteractionTouchReply(TouchModelReply, AppraisedReply):
    appraisal: TouchAppraisal


class InteractionChatReply(MemoryModelReply, AppraisedReply):
    pass
