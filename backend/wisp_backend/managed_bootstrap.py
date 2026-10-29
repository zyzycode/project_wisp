"""Strict, bounded private-pipe configuration for a desktop-owned backend."""

from pathlib import Path
from typing import BinaryIO

from pydantic import BaseModel, ConfigDict, Field, SecretStr, ValidationError, field_validator
from wisp_backend.config.settings import AssistantSettings, Settings
from wisp_backend.json_codec import decode_json

BOOTSTRAP_LIMIT = 16 * 1024


class BootstrapError(ValueError):
    """A fixed error category; never retains rejected input or validation details."""


class ManagedBootstrap(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid", strict=True, hide_input_in_errors=True)

    apiKey: SecretStr = Field(repr=False)
    sessionToken: SecretStr = Field(repr=False)
    ledgerPath: str

    @field_validator("apiKey")
    @classmethod
    def validate_key(cls, secret: SecretStr) -> SecretStr:
        value = secret.get_secret_value()
        if any(ord(char) < 32 or ord(char) == 127 for char in value):
            raise ValueError("Invalid key")
        value = value.strip()
        if not 1 <= len(value) <= 512 or any(not 33 <= ord(char) <= 126 for char in value):
            raise ValueError("Invalid key")
        return SecretStr(value)

    @field_validator("sessionToken")
    @classmethod
    def validate_token(cls, secret: SecretStr) -> SecretStr:
        value = secret.get_secret_value()
        if len(value) != 64 or any(char not in "0123456789abcdef" for char in value):
            raise ValueError("Invalid session token")
        return secret

    @field_validator("ledgerPath")
    @classmethod
    def validate_path(cls, value: str) -> str:
        if any(ord(char) < 32 or ord(char) == 127 for char in value):
            raise ValueError("Invalid ledger path")
        if not Path(value).is_absolute() or len(value.encode("utf-8")) > 4096:
            raise ValueError("Invalid ledger path")
        return value

    def settings(self) -> Settings:
        """Explicit defaults: no dotenv, process env, model or URL override."""
        return Settings(
            api_key=self.apiKey,
            assistants={"default": AssistantSettings(provider="openai")},
            ledger_path=Path(self.ledgerPath),
        )


def read_bootstrap(stream: BinaryIO) -> ManagedBootstrap:
    record = stream.readline(BOOTSTRAP_LIMIT + 1)
    try:
        if len(record) > BOOTSTRAP_LIMIT or not record.endswith(b"\n"):
            raise ValueError("Invalid bootstrap framing")
        if any(byte < 32 or byte == 127 for byte in record[:-1]):
            raise ValueError("Invalid bootstrap controls")
        return ManagedBootstrap.model_validate(decode_json(record[:-1].decode("utf-8")))
    except (ValueError, ValidationError, UnicodeError, RecursionError):
        raise BootstrapError("Invalid managed bootstrap") from None
