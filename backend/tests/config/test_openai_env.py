"""OpenAI credentials and model selection are server-owned and isolated."""

import pytest

from wisp_backend.config.loader import load_settings


def test_openai_environment_selects_own_key_and_defaults(env_values, monkeypatch):
    env_values.update(WISP_AI_PROVIDER="openai", OPENAI_API_KEY="file-key",
                      GEMINI_API_KEY="google-key", GROQ_API_KEY="groq-key", token_api="legacy-key")
    monkeypatch.setenv("OPENAI_API_KEY", " process-key ")
    settings = load_settings()
    assert settings.api_key.get_secret_value() == "process-key"
    assert settings.base_url == "https://api.openai.com/v1/"
    assert settings.assistants["default"].model == "gpt-4.1-mini"


@pytest.mark.parametrize("key", [None, "", " "])
def test_openai_never_uses_another_provider_key(env_values, key):
    env_values.update(WISP_AI_PROVIDER="openai", OPENAI_API_KEY=key,
                      GEMINI_API_KEY="google-key", GROQ_API_KEY="groq-key", token_api="legacy-key")
    with pytest.raises(RuntimeError, match="OPENAI_API_KEY"):
        load_settings()


@pytest.mark.parametrize("field,value", [("MODEL", "gemini-3.8-flash"), ("THINKING_LEVEL", "low")])
def test_incompatible_openai_options_fail_before_dispatch(env_values, field, value):
    env_values.update(WISP_AI_PROVIDER="openai", OPENAI_API_KEY="test-key")
    env_values[f"WISP_AI_{field}"] = value
    with pytest.raises(ValueError):
        load_settings()


def test_astra_model_is_selected_explicitly(env_values):
    env_values.update(WISP_AI_PROVIDER="openai", OPENAI_API_KEY="test-key", WISP_AI_MODEL="gpt-6-astra")
    settings = load_settings()
    assert settings.assistants["default"].model == "gpt-6-astra"
    assert settings.profile.reservation == 1_050_000


def test_astra_rejects_temperature_before_dispatch(env_values):
    env_values.update(WISP_AI_PROVIDER="openai", OPENAI_API_KEY="test-key",
                      WISP_AI_MODEL="gpt-6-astra", WISP_AI_TEMPERATURE="0.4")
    with pytest.raises(ValueError, match="temperature"):
        load_settings()
