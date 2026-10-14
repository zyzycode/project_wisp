"""Validated runtime settings, independent of environment loading."""

from ipaddress import ip_address
from pathlib import Path
from typing import Any, Literal
from urllib.parse import urlsplit, urlunsplit

from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator, model_validator

from wisp_backend.config.profiles import PROFILES, ProviderProfile, get_profile


class AssistantSettings(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    name: str = "Assistant"
    provider: str = "groq"
    model: str = Field(default="openai/gpt-oss-20b", min_length=1)
    max_output_tokens: int = Field(default=4096, gt=0, le=4096, strict=True)
    temperature: float | None = Field(default=None, ge=0, le=2)
    thinking_level: Literal["minimal", "low", "medium", "high"] | None = None

    @model_validator(mode="before")
    @classmethod
    def default_model(cls, value: Any) -> Any:
        if isinstance(value, dict) and "model" not in value:
            provider = value.get("provider", "groq")
            if isinstance(provider, str) and provider in PROFILES:
                value = {**value, "model": PROFILES[provider].default_model}
        return value

    @property
    def effective_thinking_level(self) -> str:
        return self.thinking_level or ("minimal" if self.model == "gemini-3.5-flash-lite" else "low")


class LedgerSettings(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    rate_limit: int = Field(default=12, gt=0, strict=True)
    concurrent_limit: int = Field(default=2, gt=0, strict=True)
    daily_requests: int = Field(default=100, gt=0, strict=True)
    daily_tokens: int = Field(default=1_000_000, ge=131_072, strict=True)


class Settings(BaseModel):
    """Validated values and cross-field invariants shared by all startup paths."""

    model_config = ConfigDict(frozen=True)

    api_key: SecretStr
    assistants: dict[str, AssistantSettings] = Field(
        default_factory=lambda: {"default": AssistantSettings()}, min_length=1,
    )
    base_url: str = "https://api.groq.com/openai/v1/"
    request_timeout: float = Field(default=10, gt=0, le=10)
    connect_timeout: float = Field(default=3, gt=0, le=3)
    pool_timeout: float = Field(default=3, gt=0, le=3)
    upstream_trust_env: bool = False
    ledger_path: Path = Path.home() / ".local" / "state" / "wisp-backend" / "ledger.sqlite"
    ledger: LedgerSettings = Field(default_factory=LedgerSettings)

    @model_validator(mode="before")
    @classmethod
    def provider_defaults(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value
        value = dict(value)
        assistants = value.get("assistants", {})
        if not isinstance(assistants, dict):
            return value
        default = assistants.get("default", {})
        if isinstance(default, AssistantSettings):
            provider = default.provider
        else:
            provider = default.get("provider", "groq") if isinstance(default, dict) else "groq"
        profile = get_profile(provider)
        value.setdefault("base_url", profile.base_url)
        ledger = value.get("ledger", {})
        if isinstance(ledger, dict):
            value["ledger"] = {"daily_tokens": profile.daily_tokens, **ledger}
        return value

    @property
    def provider(self) -> str:
        return self.assistants["default"].provider

    @property
    def profile(self) -> ProviderProfile:
        return get_profile(self.provider)

    @model_validator(mode="after")
    def validate_profiles(self) -> "Settings":
        if "default" not in self.assistants:
            raise ValueError("A default assistant is required")
        for profile in self.assistants.values():
            if profile.provider != self.provider or profile.model not in self.profile.models:
                raise ValueError("Unsupported model reservation profile")
            if profile.thinking_level is not None:
                if profile.provider != "gemini":
                    raise ValueError("thinking_level is supported only for Gemini")
                if profile.model == "gemini-3.8-flash" and profile.thinking_level == "minimal":
                    raise ValueError("Selected model does not support minimal thinking")
        if self.ledger.daily_tokens < self.profile.reservation:
            raise ValueError("daily_tokens must cover the selected model reservation")
        return self

    @field_validator("base_url")
    @classmethod
    def validate_base_url(cls, value: str) -> str:
        value = value.strip()
        if any(ord(char) <= 32 for char in value) or any(char in value for char in "\\?#"):
            raise ValueError("AI base URL must not contain whitespace, query or fragment")
        try:
            parsed = urlsplit(value)
            host = parsed.hostname
            port = parsed.port
        except ValueError:
            raise ValueError("Invalid AI base URL") from None
        if not host or parsed.username is not None or parsed.password is not None or port == 0:
            raise ValueError("AI base URL requires a host and no embedded credentials")
        try:
            loopback = ip_address(host).is_loopback
        except ValueError:
            loopback = host.lower() == "localhost"
        if parsed.scheme != "https" and not (parsed.scheme == "http" and loopback):
            raise ValueError("AI base URL requires HTTPS or loopback HTTP")
        return urlunsplit((parsed.scheme, parsed.netloc, parsed.path.rstrip("/") + "/", "", ""))

    @field_validator("api_key")
    @classmethod
    def validate_key(cls, value: SecretStr) -> SecretStr:
        key = value.get_secret_value().strip()
        if not key:
            raise ValueError("API key must not be blank")
        return SecretStr(key)
