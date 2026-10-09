"""Configuration loaded at startup, without mutating the process environment."""

import os
from pathlib import Path
from typing import Literal

from dotenv import dotenv_values
from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator

ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


class AssistantSettings(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    name: str = "Assistant"
    provider: str = "groq"
    model: str = Field(default="openai/gpt-oss-20b", min_length=1)
    max_output_tokens: int = Field(default=4096, gt=0)
    temperature: float | None = Field(default=None, ge=0, le=2)


class Settings(BaseModel):
    model_config = ConfigDict(frozen=True)

    api_key: SecretStr | None = None
    provider: Literal["groq", "chatgpt"] = "groq"
    assistants: dict[str, AssistantSettings] = Field(
        default_factory=lambda: {"default": AssistantSettings()}, min_length=1,
    )
    base_url: str = "https://api.groq.com/openai/v1/"
    request_timeout: float = Field(default=10, gt=0)
    connect_timeout: float = Field(default=3, gt=0)
    pool_timeout: float = Field(default=3, gt=0)
    upstream_trust_env: bool = False

    @field_validator("api_key")
    @classmethod
    def validate_key(cls, value: SecretStr | None) -> SecretStr | None:
        if value is None:
            return None
        key = value.get_secret_value().strip()
        if not key:
            raise ValueError("API key must not be blank")
        return SecretStr(key)

    @classmethod
    def from_env(cls, env_file: Path = ENV_FILE) -> "Settings":
        values = {**dotenv_values(env_file), **os.environ}
        provider = values.get("WISP_AI_PROVIDER", "groq").strip().lower()
        if provider not in {"groq", "chatgpt"}:
            raise RuntimeError("WISP_AI_PROVIDER must be groq or chatgpt")
        key = values.get("GROQ_API_KEY") or values.get("token_api")
        if provider == "groq" and (not key or not key.strip()):
            raise RuntimeError("Set GROQ_API_KEY or token_api in the project .env")
        assistants = values.get("ASSISTANTS_JSON")
        trust_env = values.get("WISP_UPSTREAM_TRUST_ENV", "false").strip().lower()
        if trust_env not in {"true", "false"}:
            raise RuntimeError("WISP_UPSTREAM_TRUST_ENV must be true or false")
        if provider == "chatgpt":
            return cls(provider="chatgpt", assistants={"default": AssistantSettings(
                provider="chatgpt", model=values.get("WISP_CHATGPT_MODEL") or "saved",
            )}, base_url="https://api.openai.com/v1/", upstream_trust_env=trust_env == "true")
        if assistants:
            import json
            return cls(api_key=SecretStr(key), assistants=json.loads(assistants),
                       upstream_trust_env=trust_env == "true")
        return cls(api_key=SecretStr(key), upstream_trust_env=trust_env == "true")
