"""Exercise the execution core without FastAPI, Pydantic, HTTP or SQLite."""

import asyncio

import pytest
from tests.doubles import MemoryLedger, StubProvider
from wisp_backend.accounting.contracts import Usage
from wisp_backend.completion.context import ContextBlock, ContextMessage
from wisp_backend.completion.contracts import CompletionJob, InferenceRequest, ProviderResult
from wisp_backend.completion.service import CompletionService
from wisp_backend.errors import ErrorCode, ServiceError
from wisp_backend.outcomes import Outcome


class TextEncoder:
    def success(self, text: str) -> Outcome:
        if text != "accepted":
            raise ServiceError("invalid_model_response")
        return Outcome(200, text.encode())

    def failure(self, code: ErrorCode, retry_after_ms: int | None = None) -> Outcome:
        return Outcome(503, code.encode())


def job() -> CompletionJob:
    block = ContextBlock("current", "dialogue", True, 1000, 0, (ContextMessage("user", "synthetic"),))
    return CompletionJob("id", InferenceRequest((block,)), 10, TextEncoder())


def test_replay_skips_inference_and_settlement() -> None:
    async def run() -> None:
        ledger = MemoryLedger(replay=Outcome(200, b"cached exact bytes"))
        provider = StubProvider(ProviderResult("accepted", Usage(1, 2, 3)))
        service = CompletionService(provider, ledger)
        result = await service.complete(job(), "digest", asyncio.get_running_loop().time())
        assert result is ledger.replay
        assert provider.calls == 0 and ledger.settlements == []
        await service.close()

    asyncio.run(run())


def test_encoder_failure_keeps_paid_usage() -> None:
    async def run() -> None:
        ledger = MemoryLedger()
        usage = Usage(1, 2, 3)
        service = CompletionService(StubProvider(ProviderResult("rejected", usage)), ledger)
        result = await service.complete(job(), "digest", asyncio.get_running_loop().time())
        assert result.body == b"invalid_model_response"
        assert ledger.settlements == [(usage, result)]
        await service.close()

    asyncio.run(run())


def test_closed_service_does_not_admit_or_dispatch() -> None:
    async def run() -> None:
        ledger = MemoryLedger()
        provider = StubProvider(ProviderResult("accepted"))
        service = CompletionService(provider, ledger)
        await service.close()
        result = await service.complete(job(), "digest", asyncio.get_running_loop().time())
        assert result.body == b"upstream_unavailable"
        assert ledger.admissions == provider.calls == 0

    asyncio.run(run())


def test_background_failure_reports_no_exception_details(caplog: pytest.LogCaptureFixture) -> None:
    async def run() -> None:
        class FailedLedger(MemoryLedger):
            async def settle(self, *args: object, **kwargs: object) -> None:
                raise ServiceError("upstream_unavailable") from RuntimeError("PRIVATE_BACKEND_PAYLOAD")

        service = CompletionService(StubProvider(ProviderResult("accepted", Usage(1, 2, 3))), FailedLedger())
        result = await service.complete(job(), "digest", asyncio.get_running_loop().time())
        assert result.body == b"upstream_unavailable"
        await service.close()

    asyncio.run(run())
    assert "completion_background_failed" in caplog.text
    assert "PRIVATE_BACKEND_PAYLOAD" not in caplog.text
