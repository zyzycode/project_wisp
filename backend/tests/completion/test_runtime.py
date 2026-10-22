"""Composition failures must release every already-opened resource."""

import asyncio
from pathlib import Path

import httpx
import pytest
import wisp_backend.runtime as runtime
from pydantic import SecretStr
from tests.doubles import MemoryLedger
from wisp_backend.config.settings import Settings
from wisp_backend.errors import ServiceError


def test_failed_provider_construction_closes_client_and_database(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    client = httpx.AsyncClient(transport=httpx.MockTransport(lambda _: pytest.fail("Unexpected network")))
    settings = Settings(api_key=SecretStr("test-key"), ledger_path=tmp_path / "startup.sqlite")

    def fail_provider(*args: object) -> None:
        raise ValueError("provider construction failed")

    monkeypatch.setattr(runtime, "create_client", lambda *args: client)
    monkeypatch.setattr(runtime, "create_provider", fail_provider)

    async def run() -> None:
        with pytest.raises(ValueError, match="provider construction failed"):
            async with runtime.open_runtime(settings):
                pytest.fail("Failed startup yielded a service")
        assert client.is_closed
        # A live SQLite connection prevents this move on Windows.
        settings.ledger_path.rename(tmp_path / "closed.sqlite")

    asyncio.run(run())


def test_maintenance_failure_is_observable_without_private_details(caplog: pytest.LogCaptureFixture) -> None:
    class FailedLedger(MemoryLedger):
        async def maintain(self) -> None:
            raise ServiceError("upstream_unavailable") from RuntimeError("PRIVATE_STORAGE_DETAIL")

    asyncio.run(runtime.maintain_ledger(FailedLedger(), interval=0))
    assert "ledger_maintenance_failed" in caplog.text
    assert "PRIVATE_STORAGE_DETAIL" not in caplog.text
