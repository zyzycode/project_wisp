"""Admission, bounded provider lifetime and independent terminal settlement."""

import asyncio
import logging
from dataclasses import dataclass, field
from threading import Event
from typing import Any, TypeVar

from wisp_backend.accounting.contracts import Admission, Ledger
from wisp_backend.completion.contracts import CompletionJob, ProviderResult, ReplyEncoder
from wisp_backend.completion.ports import Provider
from wisp_backend.errors import ErrorCode, ServiceError
from wisp_backend.outcomes import Outcome

TaskResult = TypeVar("TaskResult")
logger = logging.getLogger(__name__)


@dataclass
class _RequestState:
    """Per-call ownership shared by admission, generation and terminal cleanup.

    A completed admission owns a reservation until settlement. The publication
    flag also reaches the SQLite thread, preventing a late commit from caching
    a response after the caller has timed out or disconnected.
    """

    request_id: str
    encoder: ReplyEncoder
    deadline: float
    publication_cancelled: Event = field(default_factory=Event)
    admitted: bool = False
    cancelled: bool = False
    admission_task: asyncio.Task[Admission] | None = None
    provider_task: asyncio.Task[ProviderResult] | None = None
    result: ProviderResult | None = None
    outcome: Outcome | None = None

    def remaining(self) -> float:
        return self.deadline - asyncio.get_running_loop().time()

    def fail(self, code: ErrorCode, retry_after_ms: int | None = None) -> None:
        self.outcome = self.encoder.failure(code, retry_after_ms)


class CompletionService:
    """Own active requests and background accounting for all completion routes."""

    def __init__(self, provider: Provider, ledger: Ledger, deadline: float = 10) -> None:
        self.provider = provider
        self.ledger = ledger
        self.deadline = deadline
        self.closing = False
        self.requests: set[asyncio.Task[Any]] = set()
        self.background: set[asyncio.Task[Any]] = set()

    async def complete(
        self, job: CompletionJob, digest: str, started: float, legacy_digest: str | None = None
    ) -> Outcome:
        """Admit once, generate and settle under the original HTTP deadline.

        ``started`` is monotonic time captured before reading the request body.
        Replays never dispatch or settle again. Cancellation propagates only
        after arranging independent settlement; it cannot cancel a SQLite write.
        Late provider results may correct usage, but never publish a new reply.
        """
        current = asyncio.current_task()
        assert current is not None
        self.requests.add(current)
        current.add_done_callback(self.requests.discard)
        duration = min(self.deadline, job.timeout)
        state = _RequestState(job.request_id, job.encoder, started + duration)
        try:
            if self.closing:
                raise ServiceError("upstream_unavailable")
            if state.remaining() <= 0:
                raise ServiceError("upstream_timeout")
            replay = await self._admit(state, digest, legacy_digest)
            if replay is not None:
                return replay
            await self._generate(state, job)
        except asyncio.CancelledError:
            state.cancelled = True
            state.publication_cancelled.set()
            # Cancellation can race a committed admission on the SQLite worker.
            if state.admission_task and not state.admitted:
                self._track_background(
                    asyncio.create_task(self._settle_abandoned_admission(state.admission_task, state.request_id))
                )
        except ServiceError as error:
            state.fail(error.code, error.retry_after_ms)
        finally:
            try:
                await self._settle(state)
            finally:
                self.requests.discard(current)
        if state.cancelled:
            raise asyncio.CancelledError
        assert state.outcome is not None
        return state.outcome

    async def _admit(self, state: _RequestState, digest: str, legacy_digest: str | None) -> Outcome | None:
        state.admission_task = asyncio.create_task(self.ledger.admit(state.request_id, digest, legacy_digest))
        done, _ = await asyncio.wait({state.admission_task}, timeout=state.remaining())
        if not done:
            self._track_background(
                asyncio.create_task(self._settle_abandoned_admission(state.admission_task, state.request_id))
            )
            state.admission_task = None  # Background cleanup now owns this admission.
            raise ServiceError("upstream_timeout")
        admission = state.admission_task.result()
        if admission.replay is not None:
            if state.remaining() <= 0:
                raise ServiceError("upstream_timeout")
            return admission.replay
        state.admitted = True
        return None

    async def _generate(self, state: _RequestState, job: CompletionJob) -> None:
        remaining = state.remaining()
        if remaining <= 0:
            raise ServiceError("upstream_timeout")
        state.provider_task = asyncio.create_task(self.provider.complete(job.inference, remaining))
        done, _ = await asyncio.wait({state.provider_task}, timeout=max(0, state.remaining()))
        if not done or state.remaining() <= 0:
            raise ServiceError("upstream_timeout")
        # Retain usage even when semantic validation or wire serialization fails.
        state.result = state.provider_task.result()
        if not isinstance(state.result, ProviderResult):
            raise ServiceError("invalid_model_response")
        if state.result.error:
            raise ServiceError(state.result.error)
        if not isinstance(state.result.text, str):
            raise ServiceError("invalid_model_response")
        state.outcome = job.encoder.success(state.result.text)

    async def _settle(self, state: _RequestState) -> None:
        """Cancel upstream, then commit accounting independently of delivery.

        Waiting is bounded for an HTTP response. After disconnect, shield the
        durable write; a further cancellation still leaves the tracked task alive.
        Apply late usage correction only after the first settlement completes.
        """
        if state.provider_task and not state.provider_task.done():
            state.provider_task.cancel()
        if not state.admitted:
            return
        usage = state.result.usage if isinstance(state.result, ProviderResult) else None
        settlement = self._track_background(
            asyncio.create_task(
                self.ledger.settle(state.request_id, usage, state.outcome, state.deadline, state.publication_cancelled)
            )
        )
        try:
            if state.cancelled:
                await asyncio.shield(settlement)
            else:
                done, _ = await asyncio.wait({settlement}, timeout=max(0, state.remaining()))
                if not done or state.remaining() <= 0:
                    state.publication_cancelled.set()
                    state.fail("upstream_timeout")
                else:
                    settlement.result()
        except ServiceError:
            state.fail("upstream_unavailable")
        except asyncio.CancelledError:
            state.publication_cancelled.set()
            raise
        finally:
            if state.provider_task and state.result is None:
                self._track_background(
                    asyncio.create_task(self._settle_late_usage(state.provider_task, state.request_id, settlement))
                )

    def _track_background(self, task: asyncio.Task[TaskResult]) -> asyncio.Task[TaskResult]:
        self.background.add(task)

        def finished(done: asyncio.Task[TaskResult]) -> None:
            self.background.discard(done)
            if not done.cancelled():
                if done.exception() is not None:
                    logger.error("completion_background_failed")

        task.add_done_callback(finished)
        return task

    async def _settle_late_usage(
        self, task: asyncio.Task[ProviderResult], request_id: str, settlement: asyncio.Task[None]
    ) -> None:
        try:
            await asyncio.shield(settlement)
            result = await task
            if isinstance(result, ProviderResult) and result.usage:
                await self.ledger.settle(request_id, result.usage, None)
        except (asyncio.CancelledError, ServiceError):
            pass  # The uncertain reservation is already durable.

    async def _settle_abandoned_admission(self, task: asyncio.Task[Admission], request_id: str) -> None:
        """Charge a late admission as uncertain without dispatching the provider."""
        try:
            admission = await task
            if admission.replay is None:
                await self.ledger.settle(request_id, None, None)
        except ServiceError:
            pass

    async def close(self) -> None:
        """Stop admission, cancel active requests and drain tracked accounting."""
        self.closing = True
        tasks = list(self.requests)
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        # Cooperative HTTP providers close streams on cancellation. Late usage
        # correction gets a short grace period before remaining tasks are cancelled.
        remaining = list(self.background)
        if remaining:
            _, pending = await asyncio.wait(remaining, timeout=0.5)
            for task in pending:
                task.cancel()
            await asyncio.gather(*remaining, return_exceptions=True)
