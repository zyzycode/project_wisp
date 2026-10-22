import json
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from tests.helpers import provider_transport
from wisp_backend.application import create_app
from wisp_backend.config.settings import Settings


@pytest.fixture
def body():
    return json.loads((Path(__file__).parent / "fixtures/request.local.json").read_text(encoding="utf-8"))


@pytest.fixture
def app_factory(tmp_path):
    def factory(handler, **options):
        count_handler = options.pop("count_handler", None)
        options.setdefault("ledger_path", tmp_path / f"{uuid4()}.sqlite")
        return create_app(
            provider_transport(handler, count_handler), settings=Settings(api_key=SecretStr("test-key"), **options)
        )

    return factory


@pytest.fixture
def client_factory(app_factory):
    return lambda handler: TestClient(app_factory(handler))


@pytest.fixture
def completion():
    def factory(reply=None, **extra):
        extra.setdefault("usage", {"prompt_tokens": 5, "completion_tokens": 2, "total_tokens": 7})
        return {
            "choices": [
                {
                    "message": {"content": json.dumps(reply if reply is not None else {"text": "Привет!"})},
                    "finish_reason": "stop",
                }
            ],
            **extra,
        }

    return factory


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
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    for name in (
        "BASE_URL",
        "MAX_OUTPUT_TOKENS",
        "TEMPERATURE",
        "THINKING_LEVEL",
        "REQUEST_TIMEOUT",
        "CONNECT_TIMEOUT",
        "POOL_TIMEOUT",
    ):
        monkeypatch.delenv(f"WISP_AI_{name}", raising=False)
    values = {}
    monkeypatch.setattr("wisp_backend.config.loader.dotenv_values", lambda _: values)
    return values
