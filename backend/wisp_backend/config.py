"""Configuration loaded at startup, without mutating the process environment."""

import os
import json
from ipaddress import ip_address
from pathlib import Path
from typing import Any, Literal
from urllib.parse import urlsplit, urlunsplit

from dotenv import dotenv_values
from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator, model_validator
from wisp_backend.providers.profiles import PROFILES, ProviderProfile, get_profile

ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


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

    @classmethod
    def from_env(cls, env_file: Path = ENV_FILE) -> "Settings":
        values = {**dotenv_values(env_file), **os.environ}
        assistants = values.get("ASSISTANTS_JSON")
        profiles = json.loads(assistants) if assistants else {"default": {}}
        if not isinstance(profiles, dict) or not isinstance(profiles.get("default"), dict):
            raise ValueError("ASSISTANTS_JSON requires a default profile object")
        default = dict(profiles["default"])
        for variable, field in (("WISP_AI_PROVIDER", "provider"), ("WISP_AI_MODEL", "model"),
                                ("WISP_AI_MAX_OUTPUT_TOKENS", "max_output_tokens"),
                                ("WISP_AI_TEMPERATURE", "temperature"),
                                ("WISP_AI_THINKING_LEVEL", "thinking_level")):
            if variable in values:
                raw = (values[variable] or "").strip()
                if not raw and field != "provider":
                    continue
                selected: str | int | float = raw
                try:
                    if field == "max_output_tokens":
                        selected = int(raw)
                    elif field == "temperature":
                        selected = float(raw)
                except ValueError:
                    raise ValueError(f"Invalid numeric setting: {variable}") from None
                if field in default and default[field] != selected:
                    raise ValueError(f"{variable} conflicts with ASSISTANTS_JSON")
                default.setdefault(field, selected)
        profile = get_profile(default.get("provider", "groq"))
        key = values.get(profile.key_env)
        if default.get("provider", "groq") == "groq":
            key = key or values.get("token_api")
        if not key or not key.strip():
            raise RuntimeError(f"Set {profile.key_env} in backend .env")
        trust_env = values.get("WISP_UPSTREAM_TRUST_ENV", "false").strip().lower()
        if trust_env not in {"true", "false"}:
            raise RuntimeError("WISP_UPSTREAM_TRUST_ENV must be true or false")
        options: dict[str, Any] = {"api_key": SecretStr(key), "upstream_trust_env": trust_env == "true",
                                   "assistants": {**profiles, "default": default}}
        base_url = (values.get("WISP_AI_BASE_URL") or "").strip()
        if base_url:
            options["base_url"] = base_url
        for variable, field in (("WISP_AI_REQUEST_TIMEOUT", "request_timeout"),
                                ("WISP_AI_CONNECT_TIMEOUT", "connect_timeout"),
                                ("WISP_AI_POOL_TIMEOUT", "pool_timeout")):
            raw = (values.get(variable) or "").strip()
            if raw:
                try:
                    options[field] = float(raw)
                except ValueError:
                    raise ValueError(f"Invalid numeric setting: {variable}") from None
        if values.get("WISP_LEDGER_PATH"):
            options["ledger_path"] = Path(values["WISP_LEDGER_PATH"])
        if values.get("WISP_LIMITS_JSON"):
            options["ledger"] = json.loads(values["WISP_LIMITS_JSON"])
        return cls(**options)
