"""Strict one-shot crop/evidence wire; no persistent image or inferred state."""

import base64
import binascii
from typing import Annotated, Literal

from pydantic import BeforeValidator, Field, model_validator
from wisp_backend.api.schemas.common import RequestId, false_only
from wisp_backend.validation import Contract, text_type, trim_text


def jpeg_dimensions(data: bytes) -> tuple[int, int]:
    """Bounded marker/SOF checks, NOT entropy/pixel decoding or proof of valid image content."""
    if not 4 <= len(data) <= 262144 or data[:2] != b"\xff\xd8":
        raise ValueError("Invalid image structure")
    offset, scanned = 2, False
    dimensions: tuple[int, int] | None = None
    while offset < len(data):
        if data[offset] != 255:
            raise ValueError("Invalid image marker")
        while offset < len(data) and data[offset] == 255:
            offset += 1
        if offset >= len(data):
            raise ValueError("Invalid image marker")
        marker = data[offset]
        offset += 1
        if marker == 217:
            if offset != len(data) or not scanned or dimensions is None:
                raise ValueError("Invalid image ending")
            return dimensions
        # Only baseline JPEG and canonical JFIF APP0 are accepted; private APP/COM are forbidden.
        if marker not in (192, 196, 219, 221, 224, 218) or offset + 2 > len(data):
            raise ValueError("Unsupported image marker")
        size = int.from_bytes(data[offset : offset + 2], "big")
        end = offset + size
        if size < 2 or end > len(data):
            raise ValueError("Invalid image segment")
        payload = data[offset + 2 : end]
        offset = end
        if marker == 224 and (
            len(payload) != 14
            or payload[:6] != b"JFIF\x00\x01"
            or payload[6] > 2
            or payload[7] > 2
            or payload[-2:] != b"\x00\x00"
        ):
            raise ValueError("Unsupported image metadata")
        if marker == 192:
            if dimensions is not None or len(payload) < 6 or payload[0] != 8:
                raise ValueError("Invalid image dimensions")
            height = int.from_bytes(payload[1:3], "big")
            width = int.from_bytes(payload[3:5], "big")
            if payload[5] not in (1, 3) or len(payload) != 6 + 3 * payload[5]:
                raise ValueError("Unsupported image components")
            if not (32 <= width <= 1024 and 32 <= height <= 1024):
                raise ValueError("Image dimensions exceed limit")
            dimensions = width, height
        if marker == 218:
            if dimensions is None or scanned:
                raise ValueError("Unsupported image scans")
            scanned = True
            # Skip entropy bytes/stuffing/restarts, then inspect all subsequent markers too.
            while offset < len(data):
                if data[offset] != 255:
                    offset += 1
                    continue
                next_marker = offset + 1
                while next_marker < len(data) and data[next_marker] == 255:
                    next_marker += 1
                if next_marker >= len(data):
                    raise ValueError("Invalid image scan")
                if data[next_marker] == 0 or 208 <= data[next_marker] <= 215:
                    offset = next_marker + 1
                    continue
                break
    raise ValueError("Missing image ending")


class ScreenImage(Contract):
    mimeType: Literal["image/jpeg"]
    width: Annotated[int, Field(ge=32, le=1024)]
    height: Annotated[int, Field(ge=32, le=1024)]
    dataBase64: Annotated[str, Field(min_length=1, max_length=349528)]

    @model_validator(mode="after")
    def bounded_image(self) -> "ScreenImage":
        try:
            data = base64.b64decode(self.dataBase64, validate=True)
        except (ValueError, binascii.Error):
            raise ValueError("Invalid image encoding") from None
        if base64.b64encode(data).decode("ascii") != self.dataBase64:
            raise ValueError("Noncanonical image encoding")
        if jpeg_dimensions(data) != (self.width, self.height):
            raise ValueError("Image dimensions mismatch")
        return self


class ScreenObservationRequest(Contract):
    requestId: RequestId
    stream: Annotated[Literal[False], BeforeValidator(false_only)]
    locale: Literal["ru", "en"]
    policyRevision: Literal["screen-openai-2026-11"]
    image: ScreenImage


EvidenceText = text_type(160)


class ScreenObservationEvidence(Contract):
    visible: Annotated[list[EvidenceText], Field(max_length=3)]
    possible: Annotated[list[EvidenceText], Field(max_length=2)]
    unknown: Annotated[list[EvidenceText], Field(max_length=2)]

    @model_validator(mode="after")
    def bounded_evidence(self) -> "ScreenObservationEvidence":
        values = self.visible + self.possible + self.unknown
        if not values or any(value != trim_text(value) for value in values):
            raise ValueError("Invalid observation text")
        if sum(len(value.encode("utf-16-le")) // 2 for value in values) > 800:
            raise ValueError("Observation text exceeds limit")
        return self


class ScreenObservationResponse(Contract):
    requestId: RequestId
    observation: ScreenObservationEvidence


class ScreenObservationAvailable(Contract):
    status: Literal["available"]
    provider: Literal["openai"]
    model: Literal["gpt-6-astra"]
    policyRevision: Literal["screen-openai-2026-11"]


class ScreenObservationUnavailable(Contract):
    status: Literal["unavailable"]
    reason: Literal["unsupported_profile", "policy_unconfirmed"]
