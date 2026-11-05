"""Target #131: phrase a verified manual-placement request; no OS/window control."""

from typing import Literal

from wisp_backend.api.schemas.memory_timestamp import Timestamp
from wisp_backend.validation import Contract, text_type


class WindowHelpEvent(Contract):
    type: Literal["window_help_requested"]
    occurredAt: Timestamp
    targetRegion: Literal[
        "upper_left",
        "upper_center",
        "upper_right",
        "middle_left",
        "middle_center",
        "middle_right",
        "lower_left",
        "lower_center",
        "lower_right",
    ]


class PreviousWindowHelpInitiative(Contract):
    kind: Literal["window_help"]
    text: text_type(240)
    createdAt: Timestamp
    outcome: Literal["waiting", "assisting", "fulfilled", "declined", "unanswered", "cancelled", "target_lost"]
