"""The private startup channel rejects malformed data without retaining secrets."""

import io
import json
from pathlib import Path

import pytest
from wisp_backend.managed_bootstrap import BOOTSTRAP_LIMIT, BootstrapError, read_bootstrap


def record(tmp_path: Path, **changes: object) -> bytes:
    value = {"apiKey": "synthetic-openai-key", "sessionToken": "a1" * 32, "ledgerPath": str(tmp_path / "ledger.sqlite")}
    return json.dumps(value | changes).encode("utf-8") + b"\n"


@pytest.mark.parametrize(
    "changes",
    [
        {"apiKey": ""},
        {"apiKey": " "},
        {"apiKey": 123},
        {"apiKey": None},
        {"apiKey": "x" * 513},
        {"apiKey": "not ascii 🔑"},
        {"apiKey": "two words"},
        {"apiKey": "key\n"},
        {"apiKey": "key\t"},
        {"sessionToken": "a" * 63},
        {"sessionToken": "A" * 64},
        {"sessionToken": 123},
        {"sessionToken": "g" * 64},
        {"ledgerPath": "relative.sqlite"},
        {"ledgerPath": "/path\x00/file"},
        {"ledgerPath": "/path\n/file"},
        {"ledgerPath": "/" + "ж" * 2048},
        {"ledgerPath": "\ud800"},
        {"ledgerPath": 123},
        {"unknown": "value"},
    ],
)
def test_invalid_fields_have_one_safe_error(tmp_path: Path, changes: dict[str, object]) -> None:
    with pytest.raises(BootstrapError, match="^Invalid managed bootstrap$"):
        read_bootstrap(io.BytesIO(record(tmp_path, **changes)))


@pytest.mark.parametrize(
    "value",
    [b"", b"{}", b"{}\r\n", b"{\t}\n", b"{\xff}\n", b"null\n", b"[]\n", b'{"apiKey":NaN}\n'],
)
def test_invalid_records(value: bytes) -> None:
    with pytest.raises(BootstrapError):
        read_bootstrap(io.BytesIO(value))


def test_duplicates_and_overlong_record_are_rejected(tmp_path: Path) -> None:
    duplicate = record(tmp_path).replace(b'{"apiKey":', b'{"apiKey":"do-not-echo","apiKey":')
    stream = io.BytesIO(b" " * (BOOTSTRAP_LIMIT * 2))
    for source in (io.BytesIO(duplicate), stream):
        with pytest.raises(BootstrapError) as error:
            read_bootstrap(source)
        assert "do-not-echo" not in str(error.value)
    assert stream.tell() == BOOTSTRAP_LIMIT + 1


def test_explicit_profile_ignores_env_and_dotenv(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    def forbidden_env_read(*_: object) -> None:
        pytest.fail("managed configuration must not read dotenv")

    monkeypatch.setattr("wisp_backend.config.loader.dotenv_values", forbidden_env_read)
    for key, value in {
        "OPENAI_API_KEY": "operator-key",
        "WISP_AI_PROVIDER": "gemini",
        "WISP_AI_MODEL": "untrusted-model",
        "WISP_AI_BASE_URL": "http://127.0.0.1:1",
        "WISP_LEDGER_PATH": "/untrusted/ledger.sqlite",
        "WISP_UPSTREAM_TRUST_ENV": "true",
    }.items():
        monkeypatch.setenv(key, value)
    parsed = read_bootstrap(io.BytesIO(record(tmp_path, apiKey="  synthetic-openai-key  ")))
    settings = parsed.settings()
    assert settings.provider == "openai"
    assert settings.base_url == "https://api.openai.com/v1/"
    assert settings.api_key.get_secret_value() == "synthetic-openai-key"
    assert settings.assistants["default"].model == settings.profile.default_model
    assert settings.ledger_path == tmp_path / "ledger.sqlite"
    assert not settings.upstream_trust_env
    assert "synthetic-openai-key" not in repr(parsed)


def test_bootstrap_consumes_exactly_one_record(tmp_path: Path) -> None:
    stream = io.BytesIO(record(tmp_path) + b"second-record")
    read_bootstrap(stream)
    assert stream.read() == b"second-record"
