"""Validated process logging options, without output or environment side effects."""

import json
import re
from collections.abc import Mapping
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

LEVELS = {"DEBUG": 10, "INFO": 20, "WARNING": 30, "ERROR": 40, "CRITICAL": 50, "OFF": 100}


class LoggingSettings(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    format: Literal["console", "json"] = "console"
    level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL", "OFF"] = "INFO"
    overrides: dict[str, str] = Field(default_factory=dict)
    queue_capacity: int = Field(default=1024, ge=1, le=10000)
    shutdown_timeout: float = Field(default=0.2, ge=0, le=2)

    @field_validator("overrides")
    @classmethod
    def validate_overrides(cls, values: dict[str, str]) -> dict[str, str]:
        if len(values) > 32 or any(
            not re.fullmatch(r"[a-zA-Z_][a-zA-Z0-9_.]{0,127}", name) or level not in LEVELS
            for name, level in values.items()
        ):
            raise ValueError("Invalid logging module override")
        return values


def logging_settings(values: Mapping[str, Any]) -> LoggingSettings:
    options: dict[str, Any] = {}
    for variable, field in (
        ("WISP_LOG_FORMAT", "format"),
        ("WISP_LOG_LEVEL", "level"),
        ("WISP_LOG_QUEUE_CAPACITY", "queue_capacity"),
        ("WISP_LOG_SHUTDOWN_TIMEOUT", "shutdown_timeout"),
        ("WISP_LOG_OVERRIDES", "overrides"),
    ):
        raw = values.get(variable)
        if raw:
            try:
                options[field] = json.loads(raw) if field == "overrides" else raw
            except (ValueError, TypeError):
                raise ValueError(f"Invalid logging setting: {variable}") from None
    try:
        return LoggingSettings(**options)
    except ValueError:
        raise ValueError("Invalid WISP_LOG configuration; check LOGGING.md") from None
