import os
from pathlib import Path

import pytest
from pydantic import SecretStr, ValidationError

from wisp_backend.config import Settings


@pytest.fixture
def env_values(monkeypatch):
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    monkeypatch.delenv("token_api", raising=False)
    monkeypatch.delenv("ASSISTANTS_JSON", raising=False)
    monkeypatch.delenv("WISP_UPSTREAM_TRUST_ENV", raising=False)
    monkeypatch.delenv("WISP_LEDGER_PATH", raising=False)
    monkeypatch.delenv("WISP_LIMITS_JSON", raising=False)
    monkeypatch.delenv("WISP_AI_PROVIDER", raising=False)
    monkeypatch.delenv("WISP_AI_MODEL", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    for name in ("BASE_URL", "MAX_OUTPUT_TOKENS", "TEMPERATURE", "THINKING_LEVEL",
                 "REQUEST_TIMEOUT", "CONNECT_TIMEOUT", "POOL_TIMEOUT"):
        monkeypatch.delenv(f"WISP_AI_{name}", raising=False)
    values = {}
    monkeypatch.setattr("wisp_backend.config.dotenv_values", lambda _: values)
    return values


def test_environment_precedence_and_no_mutation(monkeypatch, env_values):
    env_values.update(GROQ_API_KEY="file-key", token_api="legacy-key")
    monkeypatch.setenv("GROQ_API_KEY", " process-key ")
    settings = Settings.from_env()
    assert settings.api_key.get_secret_value() == "process-key"
    assert "token_api" not in os.environ
    assert "process-key" not in repr(settings)


def test_custom_env_file(monkeypatch):
    def read(path):
        assert path == Path("custom.env")
        return {"GROQ_API_KEY": "file-key"}
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    monkeypatch.setattr("wisp_backend.config.dotenv_values", read)
    assert Settings.from_env(Path("custom.env")).api_key.get_secret_value() == "file-key"


@pytest.mark.parametrize("values", [{"token_api": "legacy"}, {"GROQ_API_KEY": "", "token_api": "legacy"}])
def test_legacy_key(env_values, values):
    env_values.update(values)
    assert Settings.from_env().api_key.get_secret_value() == "legacy"


@pytest.mark.parametrize("values", [{}, {"GROQ_API_KEY": "   "}])
def test_missing_key(env_values, values):
    env_values.update(values)
    with pytest.raises(RuntimeError, match="Set GROQ_API_KEY"):
        Settings.from_env()


@pytest.mark.parametrize("kwargs", [
    {"api_key": SecretStr(" ")}, {"api_key": SecretStr("key"), "request_timeout": 0},
])
def test_explicit_settings_validation(kwargs):
    with pytest.raises(ValidationError):
        Settings(**kwargs)


def test_server_profiles_from_environment(env_values):
    env_values.update(GROQ_API_KEY="key", ASSISTANTS_JSON=
        '{"default":{"provider":"groq","model":"openai/gpt-oss-20b","max_output_tokens":256}}')
    settings = Settings.from_env()
    assert settings.assistants["default"].model == "openai/gpt-oss-20b"
    assert settings.assistants["default"].max_output_tokens == 256


@pytest.mark.parametrize("value,expected", [("true", True), ("false", False), (" TRUE ", True)])
def test_explicit_upstream_environment(env_values, value, expected):
    env_values.update(GROQ_API_KEY="key", WISP_UPSTREAM_TRUST_ENV=value)
    assert Settings.from_env().upstream_trust_env is expected


def test_invalid_upstream_environment(env_values):
    env_values.update(GROQ_API_KEY="key", WISP_UPSTREAM_TRUST_ENV="maybe")
    with pytest.raises(RuntimeError, match="WISP_UPSTREAM_TRUST_ENV"):
        Settings.from_env()


@pytest.mark.parametrize('profile', [
    {'model':'unreviewed'}, {'provider':'other'}, {'max_output_tokens':4097},
    {'max_output_tokens': True},
])
def test_unreviewed_profile_or_limits_rejected(profile):
    with pytest.raises(ValidationError):
        Settings(api_key=SecretStr('test'), assistants={'default':profile})


def test_operator_limits_and_ledger_path(env_values):
    env_values.update(GROQ_API_KEY='test', WISP_LEDGER_PATH='/tmp/operator.sqlite',
        WISP_LIMITS_JSON='{"rate_limit":4,"concurrent_limit":1,"daily_requests":8,"daily_tokens":131072}')
    config = Settings.from_env()
    assert config.ledger_path == Path('/tmp/operator.sqlite')
    assert config.ledger.rate_limit == 4
    for invalid in ({'rate_limit':True}, {'daily_tokens':131071}, {'concurrent_limit':0}, {'extra':1}):
        with pytest.raises(ValidationError):
            Settings(api_key=SecretStr('test'), ledger=invalid)


def test_gemini_environment_selects_own_key_and_defaults(env_values):
    env_values.update(WISP_AI_PROVIDER="gemini", GEMINI_API_KEY="google-key",
                      GROQ_API_KEY="groq-key", token_api="legacy-key")
    settings = Settings.from_env()
    assert settings.provider == "gemini"
    assert settings.api_key.get_secret_value() == "google-key"
    assert settings.assistants["default"].model == "gemini-3.5-flash-lite"
    assert settings.base_url == "https://generativelanguage.googleapis.com/v1beta/"
    assert settings.ledger.daily_tokens == 2_000_000
    assert settings.profile.reservation == 1_114_112
    assert "google-key" not in repr(settings)


def test_gemini_never_uses_groq_or_legacy_key(env_values):
    env_values.update(WISP_AI_PROVIDER="gemini", GROQ_API_KEY="groq-key", token_api="legacy-key")
    with pytest.raises(RuntimeError, match="GEMINI_API_KEY"):
        Settings.from_env()


def test_explicit_gemini_model_and_partial_limits(env_values):
    env_values.update(WISP_AI_PROVIDER="gemini", WISP_AI_MODEL="gemini-3.8-flash",
                      GEMINI_API_KEY="test", WISP_LIMITS_JSON='{"daily_requests":5}')
    settings = Settings.from_env()
    assert settings.assistants["default"].model == "gemini-3.8-flash"
    assert settings.ledger.daily_tokens == 2_000_000
    assert settings.ledger.daily_requests == 5


@pytest.mark.parametrize("extra", [
    {"WISP_AI_PROVIDER": "unknown"}, {"WISP_AI_MODEL": "unknown"},
    {"WISP_AI_PROVIDER": ""}, {"WISP_LIMITS_JSON": '{"daily_tokens":1000000}'},
    {"ASSISTANTS_JSON": '{"default":{"provider":"groq"}}'},
    {"ASSISTANTS_JSON": '{"default":{"model":"gemini-3.8-flash"}}', "WISP_AI_MODEL": "gemini-3.5-flash-lite"},
    {"ASSISTANTS_JSON": '[]'}, {"ASSISTANTS_JSON": '{"default":null}'},
])
def test_invalid_or_conflicting_selection_fails_closed(env_values, extra):
    env_values.update(WISP_AI_PROVIDER="gemini", GEMINI_API_KEY="test")
    env_values.update(extra)
    with pytest.raises(ValueError):
        Settings.from_env()


def test_legacy_assistants_can_select_gemini(env_values):
    env_values.update(GEMINI_API_KEY="test", ASSISTANTS_JSON='{"default":{"provider":"gemini"}}')
    assert Settings.from_env().provider == "gemini"


def test_mixed_provider_profiles_rejected():
    with pytest.raises(ValidationError):
        Settings(api_key=SecretStr("test"), assistants={"default": {"provider": "gemini"}, "other": {"provider": "groq"}})
