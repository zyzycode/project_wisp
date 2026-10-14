"""Resolve startup configuration sources without mutating the process environment."""

from collections.abc import Mapping
import json
import os
from pathlib import Path
from typing import Any

from dotenv import dotenv_values
from pydantic import SecretStr

from wisp_backend.config.profiles import get_profile
from wisp_backend.config.settings import Settings


ENV_FILE = Path(__file__).resolve().parents[2] / ".env"
ASSISTANT_FIELDS = (
    ("WISP_AI_PROVIDER", "provider"),
    ("WISP_AI_MODEL", "model"),
    ("WISP_AI_MAX_OUTPUT_TOKENS", "max_output_tokens"),
    ("WISP_AI_TEMPERATURE", "temperature"),
    ("WISP_AI_THINKING_LEVEL", "thinking_level"),
)
TIMEOUT_FIELDS = (
    ("WISP_AI_REQUEST_TIMEOUT", "request_timeout"),
    ("WISP_AI_CONNECT_TIMEOUT", "connect_timeout"),
    ("WISP_AI_POOL_TIMEOUT", "pool_timeout"),
)


def load_settings(env_file: Path = ENV_FILE) -> Settings:
    """Apply process-over-file precedence, resolve legacy profiles, then validate.

    Blank optional overrides keep profile/default values. Explicit conflicts with
    ASSISTANTS_JSON fail before constructing clients or accessing a provider.
    """
    values = {**dotenv_values(env_file), **os.environ}
    assistants = _assistant_profiles(values)
    provider = assistants["default"].get("provider", "groq")
    options: dict[str, Any] = {
        "api_key": _provider_key(values, provider),
        "assistants": assistants,
        **_transport_options(values),
    }
    ledger_path = values.get("WISP_LEDGER_PATH")
    if ledger_path:
        options["ledger_path"] = Path(ledger_path)
    return Settings(**options)


def _number(raw: str, variable: str, convert: type[int] | type[float]) -> int | float:
    try:
        return convert(raw)
    except ValueError:
        raise ValueError(f"Invalid numeric setting: {variable}") from None


def _assistant_profiles(values: Mapping[str, Any]) -> dict[str, Any]:
    """Merge the default profile only; Settings validates all resulting profiles."""
    raw_profiles = values.get("ASSISTANTS_JSON")
    profiles = json.loads(raw_profiles) if raw_profiles else {"default": {}}
    if not isinstance(profiles, dict) or not isinstance(profiles.get("default"), dict):
        raise ValueError("ASSISTANTS_JSON requires a default profile object")
    default = dict(profiles["default"])
    for variable, field in ASSISTANT_FIELDS:
        if variable not in values:
            continue
        raw = (values[variable] or "").strip()
        if not raw and field != "provider":
            continue
        selected: str | int | float = raw
        if field == "max_output_tokens":
            selected = _number(raw, variable, int)
        elif field == "temperature":
            selected = _number(raw, variable, float)
        if field in default and default[field] != selected:
            raise ValueError(f"{variable} conflicts with ASSISTANTS_JSON")
        default.setdefault(field, selected)
    return {**profiles, "default": default}


def _provider_key(values: Mapping[str, Any], provider: str) -> SecretStr:
    """A different provider's key is never a fallback for the selected provider."""
    profile = get_profile(provider)
    key = values.get(profile.key_env)
    if provider == "groq":
        key = key or values.get("token_api")
    if not key or not key.strip():
        raise RuntimeError(f"Set {profile.key_env} in backend .env")
    return SecretStr(key)


def _transport_options(values: Mapping[str, Any]) -> dict[str, Any]:
    trust_env = values.get("WISP_UPSTREAM_TRUST_ENV", "false").strip().lower()
    if trust_env not in {"true", "false"}:
        raise RuntimeError("WISP_UPSTREAM_TRUST_ENV must be true or false")
    options: dict[str, Any] = {"upstream_trust_env": trust_env == "true"}
    base_url = (values.get("WISP_AI_BASE_URL") or "").strip()
    if base_url:
        options["base_url"] = base_url
    for variable, field in TIMEOUT_FIELDS:
        raw = (values.get(variable) or "").strip()
        if raw:
            options[field] = _number(raw, variable, float)
    return options
