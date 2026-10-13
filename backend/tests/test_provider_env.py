"""Operator env settings reach adapters without relaxing protocol boundaries."""
import json

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr, ValidationError

from wisp_backend.config import Settings
from tests.test_config import env_values  # shared isolated environment fixture
from tests.test_gemini import completion


def test_full_environment_reaches_gemini_transport(env_values, monkeypatch, app_factory, body):
    env_values.update(WISP_AI_PROVIDER="gemini", GEMINI_API_KEY="test-key",
                      WISP_AI_BASE_URL="https://gateway.example.test/gemini",
                      WISP_AI_MODEL="gemini-3.8-flash", WISP_AI_MAX_OUTPUT_TOKENS="128",
                      WISP_AI_TEMPERATURE="0.6", WISP_AI_THINKING_LEVEL="low",
                      WISP_AI_REQUEST_TIMEOUT="8", WISP_AI_CONNECT_TIMEOUT="2", WISP_AI_POOL_TIMEOUT="1")
    monkeypatch.setenv("WISP_AI_TEMPERATURE", "0.7")
    settings = Settings.from_env()
    def handler(request):
        assert str(request.url) == "https://gateway.example.test/gemini/models/gemini-3.8-flash:generateContent"
        generation = json.loads(request.content)["generationConfig"]
        assert generation["maxOutputTokens"] == 128
        assert generation["temperature"] == .7
        assert generation["thinkingConfig"] == {"thinkingLevel": "low"}
        assert request.headers["x-goog-api-key"] == "test-key"
        assert request.extensions["timeout"]["connect"] == 2
        assert request.extensions["timeout"]["pool"] == 1
        assert 0 < request.extensions["timeout"]["read"] <= 8
        return httpx.Response(200, json=completion())
    options = settings.model_dump(exclude={"api_key", "ledger_path"})
    with TestClient(app_factory(handler, **options)) as client:
        assert client.post("/v1/chat", json=body).status_code == 200


def test_blank_optional_settings_keep_defaults(env_values):
    env_values.update(GROQ_API_KEY="test")
    for name in ("MODEL", "BASE_URL", "MAX_OUTPUT_TOKENS", "TEMPERATURE", "THINKING_LEVEL",
                 "REQUEST_TIMEOUT", "CONNECT_TIMEOUT", "POOL_TIMEOUT"):
        env_values[f"WISP_AI_{name}"] = " "
    settings = Settings.from_env()
    assert settings.base_url == "https://api.groq.com/openai/v1/"
    assert settings.request_timeout == 10
    assert settings.assistants["default"].max_output_tokens == 4096
    assert settings.assistants["default"].temperature is None


@pytest.mark.parametrize("name,value", [
    ("MAX_OUTPUT_TOKENS", "0"), ("MAX_OUTPUT_TOKENS", "4097"), ("MAX_OUTPUT_TOKENS", "1.2"),
    ("MAX_OUTPUT_TOKENS", "true"), ("TEMPERATURE", "-1"), ("TEMPERATURE", "2.1"),
    ("TEMPERATURE", "NaN"), ("TEMPERATURE", "text"), ("THINKING_LEVEL", "unknown"),
    ("REQUEST_TIMEOUT", "11"), ("REQUEST_TIMEOUT", "0"), ("REQUEST_TIMEOUT", "NaN"),
    ("CONNECT_TIMEOUT", "4"), ("CONNECT_TIMEOUT", "Infinity"), ("POOL_TIMEOUT", "-1"),
    ("POOL_TIMEOUT", "text"),
])
def test_invalid_env_values_fail_at_startup(env_values, name, value):
    env_values.update(WISP_AI_PROVIDER="gemini", GEMINI_API_KEY="test")
    env_values[f"WISP_AI_{name}"] = value
    with pytest.raises(ValueError):
        Settings.from_env()


@pytest.mark.parametrize("url", [
    "http://external.example/v1", "ftp://localhost/", "https://user:password@host/",
    "https://host/?key=secret", "https://host/#fragment", "https://", "/relative", "https://host:bad/",
    "https://host:0/", "https://host/with space/", "https://host\\evil/",
])
def test_unsafe_base_url_rejected(env_values, url):
    env_values.update(GROQ_API_KEY="test", WISP_AI_BASE_URL=url)
    with pytest.raises(ValidationError):
        Settings.from_env()


@pytest.mark.parametrize("url", ["http://localhost:123/v1", "http://127.0.0.1:123/v1", "http://[::1]:123/v1"])
def test_loopback_base_url_allowed(url):
    assert Settings(api_key=SecretStr("test"), base_url=url).base_url == url + "/"


@pytest.mark.parametrize("profile", [
    {"max_output_tokens": 256}, {"temperature": .2}, {"thinking_level": "high"},
    {"max_output_tokens": True},
])
def test_conflicting_legacy_profile_rejected(env_values, profile):
    env_values.update(WISP_AI_PROVIDER="gemini", GEMINI_API_KEY="test", WISP_AI_MAX_OUTPUT_TOKENS="128",
                      WISP_AI_TEMPERATURE="0.5", WISP_AI_THINKING_LEVEL="low",
                      ASSISTANTS_JSON=json.dumps({"default": profile}))
    with pytest.raises(ValueError):
        Settings.from_env()


@pytest.mark.parametrize("provider,model", [("groq", "openai/gpt-oss-20b"), ("gemini", "gemini-3.8-flash")])
def test_incompatible_thinking_level_rejected(env_values, provider, model):
    env_values.update(GROQ_API_KEY="test", GEMINI_API_KEY="test", WISP_AI_PROVIDER=provider,
                      WISP_AI_MODEL=model, WISP_AI_THINKING_LEVEL="minimal")
    with pytest.raises(ValueError):
        Settings.from_env()
