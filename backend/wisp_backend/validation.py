"""Shared strict value validation, independent of transport and scenarios."""

import unicodedata
from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, Field
from pydantic.fields import FieldInfo

# ECMAScript trim whitespace, matching the desktop transport boundary.
TRIM_CHARACTERS = "\t\n\x0b\x0c\r \xa0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"


def trim_text(value: str) -> str:
    return value.strip(TRIM_CHARACTERS)


def omittable() -> FieldInfo:
    # A missing optional TS field is valid; an explicit null is not its default.
    return Field(default=None, json_schema_extra=lambda schema: schema.pop("default", None))


def validate_text(value: str, limit: int) -> str:
    # Validate original length: trimming must not rescue an oversized value.
    if any(unicodedata.category(char) in ("Cc", "Cs") and char not in "\n\t" for char in value):
        raise ValueError("Forbidden control character")
    if len(value.encode("utf-16-le")) // 2 > limit or not trim_text(value):
        raise ValueError("Invalid UTF-16 text length")
    return value


def text_type(limit: int) -> object:
    return Annotated[
        str,
        AfterValidator(lambda value: validate_text(value, limit)),
        Field(description=f"Nonblank plain text, at most {limit} UTF-16 code units; no controls except newline/tab."),
    ]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)
