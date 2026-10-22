"""Isolated v1 foreground metadata; no transcript, memory or native identifiers."""

import unicodedata
from typing import Annotated, Literal

from pydantic import AfterValidator, BeforeValidator
from wisp_backend.api.schemas.common import CharacterContext, RequestId, Version, false_only
from wisp_backend.completion.replies import EventModelReply
from wisp_backend.validation import Contract, trim_text

BIDI_CONTROLS = frozenset("\u061c\u200e\u200f\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069")


def metadata_text(value: str, limit: int, *, allow_empty: bool = False) -> str:
    # The desktop normalizes before transmission; the wire never repairs input.
    if any(unicodedata.category(char) in ("Cc", "Cs") or char in BIDI_CONTROLS for char in value):
        raise ValueError("Forbidden metadata character")
    if value != trim_text(value) or (not value and not allow_empty):
        raise ValueError("Expected trimmed metadata")
    if len(value.encode("utf-16-le")) // 2 > limit:
        raise ValueError("Metadata exceeds UTF-16 limit")
    return value


AppName = Annotated[str, AfterValidator(lambda value: metadata_text(value, 80))]
WindowTitle = Annotated[str, AfterValidator(lambda value: metadata_text(value, 160, allow_empty=True))]


class Observation(Contract):
    appName: AppName
    windowTitle: WindowTitle


class ObservationRequest(Contract):
    version: Version
    requestId: RequestId
    stream: Annotated[Literal[False], BeforeValidator(false_only)]
    locale: Literal["ru", "en"]
    character: CharacterContext
    observation: Observation


class ObservationResponse(EventModelReply):
    version: Version
    requestId: RequestId
