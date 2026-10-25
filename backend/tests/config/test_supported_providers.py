"""Removed providers cannot silently select credentials or fallback at startup."""

import pytest
from pydantic import SecretStr, ValidationError
from wisp_backend.config.loader import load_settings
from wisp_backend.config.settings import Settings


def test_unconfigured_provider_defaults_to_openai(env_values: dict[str, str]) -> None:
    env_values["OPENAI_API_KEY"] = "synthetic-openai-key"
    settings = load_settings()
    assert settings.provider == "openai"
    assert settings.assistants["default"].model == "gpt-6-sol"
    assert settings.base_url == "https://api.openai.com/v1/"
    assert Settings(api_key=SecretStr("synthetic-key")).provider == "openai"


@pytest.mark.parametrize("provider", ["openai", "gemini"])
def test_removed_provider_credentials_are_never_a_fallback(env_values: dict[str, str], provider: str) -> None:
    env_values.update(WISP_AI_PROVIDER=provider, GROQ_API_KEY="synthetic-removed-key", token_api="synthetic-legacy-key")
    with pytest.raises(RuntimeError, match=f"Set {provider.upper()}_API_KEY"):
        load_settings()


def test_removed_provider_is_rejected_without_exposing_its_key(env_values: dict[str, str]) -> None:
    env_values.update(WISP_AI_PROVIDER="groq", GROQ_API_KEY="synthetic-removed-key")
    with pytest.raises(ValueError, match="Unsupported AI provider") as failure:
        load_settings()
    assert "synthetic-removed-key" not in str(failure.value)
    with pytest.raises(ValidationError, match="Unsupported AI provider"):
        Settings(api_key=SecretStr("synthetic-key"), assistants={"default": {"provider": "groq"}})
