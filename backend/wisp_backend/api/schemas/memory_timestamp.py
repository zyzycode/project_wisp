"""Calendar-validated UTC timestamps shared by independent memory schemas."""

import re
from calendar import monthrange
from typing import Annotated

from pydantic import BeforeValidator


def calendar_utc(value: object) -> str:
    if not isinstance(value, str) or not re.fullmatch(
        r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z", value, flags=re.ASCII
    ):
        raise ValueError("Expected UTC timestamp with milliseconds")
    year, month, day = map(int, value[:10].split("-"))
    hour, minute, second = map(int, value[11:19].split(":"))
    if not (1 <= month <= 12 and 1 <= day <= monthrange(year, month)[1] and hour < 24 and minute < 60 and second < 60):
        raise ValueError("Invalid calendar timestamp")
    return value


Timestamp = Annotated[str, BeforeValidator(calendar_utc)]
