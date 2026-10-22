import asyncio
import json
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from tests.helpers import TrackedStream
from wisp_backend.api.dependencies import get_completion_service
from wisp_backend.application import create_app
from wisp_backend.completion.contracts import ProviderResult
from wisp_backend.completion.service import CompletionService
from wisp_backend.config.settings import Settings


def test_client_shutdown(app_factory, monkeypatch):
    def load_env():
        pytest.fail("Explicit settings must bypass environment")

    monkeypatch.setattr("wisp_backend.application.load_settings", load_env)
    app = app_factory(lambda _: httpx.Response(200))
    with TestClient(app):
        client = app.state.completion_service.provider.client
        assert not client.is_closed
    assert client.is_closed


def test_startup_loads_settings_once(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    calls = 0
    settings = Settings(api_key=SecretStr("test-key"), ledger_path=tmp_path / "startup.sqlite")

    def load_env() -> Settings:
        nonlocal calls
        calls += 1
        return settings

    monkeypatch.setattr("wisp_backend.application.load_settings", load_env)
    app = create_app(httpx.MockTransport(lambda _: pytest.fail("Health must not call a provider")))
    with TestClient(app) as client:
        assert client.get("/health").status_code == 200
        assert client.get("/health").status_code == 200
        assert calls == 1
        assert app.state.completion_service.ledger.path == settings.ledger_path


@pytest.mark.parametrize(
    "chunks,error,status",
    [
        ([b"{"], None, 502),
        ([b""], httpx.ReadTimeout("private"), 504),
        ([b"a" * (256 * 1024 + 1), b"not-read"], None, 502),
    ],
)
def test_response_closed_and_read_bounded(client_factory, body, chunks, error, status):
    stream = TrackedStream(chunks, error)
    with client_factory(lambda _: httpx.Response(200, stream=stream)) as client:
        assert client.post("/v1/chat", json=body).status_code == status
        assert stream.closed
        assert stream.read_count == 1


def test_provider_swap_and_total_deadline(app_factory, body):
    class OtherProvider:
        async def complete(self, request, timeout):
            assert request.blocks
            return ProviderResult(
                json.dumps(
                    {"text": "Other", "appraisal": {"category": "neutral", "intensity": "low", "confidence": "clear"}}
                )
            )

    app = app_factory(lambda _: pytest.fail("Wrong provider"))
    with TestClient(app) as client:
        service = CompletionService(OtherProvider(), app.state.completion_service.ledger)
        app.dependency_overrides[get_completion_service] = lambda: service
        assert client.post("/v1/chat", json=body).json()["text"] == "Other"

        class SlowProvider:
            cancelled = False

            async def complete(self, request, timeout):
                try:
                    await asyncio.sleep(10)
                finally:
                    self.cancelled = True

        from uuid import uuid4

        body["requestId"] = str(uuid4())
        slow = SlowProvider()
        service.provider = slow
        service.deadline = 0.01
        response = client.post("/v1/chat", json=body)
        assert response.status_code == 504
        assert slow.cancelled


def test_unknown_provider_fails_at_startup():
    with pytest.raises(ValueError, match="Unsupported"):
        Settings(api_key=SecretStr("test-key"), assistants={"default": {"provider": "missing"}})
