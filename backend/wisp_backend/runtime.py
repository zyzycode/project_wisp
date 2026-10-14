"""Own startup and shutdown of the ledger, maintenance, HTTP client and execution."""

import asyncio
from collections.abc import AsyncIterator
from contextlib import AsyncExitStack, asynccontextmanager
import logging

import httpx

from wisp_backend.accounting.contracts import Ledger
from wisp_backend.accounting.sqlite_ledger import SQLiteLedger
from wisp_backend.completion.service import CompletionService
from wisp_backend.config.settings import Settings
from wisp_backend.errors import ServiceError
from wisp_backend.providers.client import create_client
from wisp_backend.providers.factory import create_provider


logger = logging.getLogger(__name__)


async def maintain_ledger(ledger: Ledger, interval: float = 60) -> None:
    while True:
        await asyncio.sleep(interval)
        try:
            await ledger.maintain()
        except ServiceError:
            # Storage failure latches the adapter closed. No payload or exception details.
            logger.error("ledger_maintenance_failed")
            return


async def stop_maintenance(task: asyncio.Task[None]) -> None:
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)


@asynccontextmanager
async def open_runtime(settings: Settings, transport: httpx.AsyncBaseTransport | None = None) -> AsyncIterator[CompletionService]:
    async with AsyncExitStack() as resources:
        ledger = await SQLiteLedger.open(settings.ledger_path, settings.ledger, reservation=settings.profile.reservation)
        resources.push_async_callback(ledger.close)
        resources.push_async_callback(stop_maintenance, asyncio.create_task(maintain_ledger(ledger)))
        client = await resources.enter_async_context(create_client(settings, transport))
        provider = create_provider(settings.assistants["default"], client)
        service = CompletionService(provider, ledger, settings.request_timeout)
        resources.push_async_callback(service.close)
        yield service
