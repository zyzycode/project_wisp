"""One-worker durable admission using SQLAlchemy ORM outside the event loop."""

import asyncio
from pathlib import Path
import threading
import time
from typing import Callable, ParamSpec, TypeVar

from sqlalchemy import delete, func, select
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from wisp_backend.accounting.contracts import Admission, RESERVATION, Usage
from wisp_backend.accounting.policy import ID_TTL, LedgerLimits, check_budget, check_rate, plan_settlement
from wisp_backend.accounting.replay import ReplayCache
from wisp_backend.accounting.models import DailyUsage, LedgerEntry, LedgerMeta
from wisp_backend.accounting.storage import create_ledger_engine, initialize_schema, ledger_session
from wisp_backend.errors import ServiceError
from wisp_backend.outcomes import MAX_RESPONSE_BYTES, Outcome


OperationArgs = ParamSpec("OperationArgs")
OperationResult = TypeVar("OperationResult")


class SQLiteLedger:
    def __init__(self, path: Path, policy: LedgerLimits, clock: Callable[[], float],
                 reservation: int = RESERVATION) -> None:
        self.path, self.policy, self.clock = path, policy, clock
        self.reservation = reservation
        self.lock = threading.Lock()
        self.cache = ReplayCache()
        self.failed = False
        self.engine: Engine | None = None
        self.db: Connection

    @classmethod
    async def open(cls, path: Path, policy: LedgerLimits,
                   clock: Callable[[], float] = time.time, *, reservation: int = RESERVATION) -> "SQLiteLedger":
        if type(reservation) is not int or reservation <= 0 or reservation > policy.daily_tokens:
            raise ValueError("Invalid model reservation")
        ledger = cls(path, policy, clock, reservation)
        try:
            await ledger._run(ledger._initialize)
        except ServiceError:
            await ledger.close()
            raise
        return ledger

    async def _run(self, operation: Callable[OperationArgs, OperationResult],
                   *args: OperationArgs.args, **kwargs: OperationArgs.kwargs) -> OperationResult:
        def guarded() -> OperationResult:
            with self.lock:
                if self.failed:
                    raise ServiceError("upstream_unavailable")
                try:
                    return operation(*args, **kwargs)
                except (SQLAlchemyError, OSError):
                    self.failed = True
                    raise ServiceError("upstream_unavailable") from None
        return await asyncio.to_thread(guarded)

    def _initialize(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.engine = create_ledger_engine(self.path)
        self.db = self.engine.connect()
        with ledger_session(self.db) as session:
            initialize_schema(session.connection())
            for key in ("clock", "halt"):
                if session.get(LedgerMeta, key) is None:
                    session.add(LedgerMeta(key=key, value=0))
            session.flush()
            pending = session.scalars(select(LedgerEntry).where(LedgerEntry.state == "flight")).all()
            for entry in pending:
                self._settle(session, entry.id, None, None)
            self._cleanup(session, self._now(session))

    def _now(self, session: Session) -> float:
        clock = session.scalars(select(LedgerMeta).where(LedgerMeta.key == "clock")).one()
        now = max(self.clock(), clock.value)
        clock.value = now
        return now

    def _cleanup(self, session: Session, now: float) -> None:
        session.execute(delete(LedgerEntry).where(LedgerEntry.admitted <= now - ID_TTL, LedgerEntry.state != "flight"))
        session.execute(delete(DailyUsage).where(DailyUsage.bucket <= int(now // ID_TTL) - 30))
        self.cache.expire(now)

    async def admit(self, request_id: str, digest: str, legacy_digest: str | None = None) -> Admission:
        return await self._run(self._admit, request_id, digest, legacy_digest)

    def _admit(self, request_id: str, digest: str, legacy_digest: str | None) -> Admission:
        # A single process lock plus SQLite transaction covers every admission decision.
        with ledger_session(self.db) as session:
            now = self._now(session)
            self._cleanup(session, now)
            entry = session.get(LedgerEntry, request_id)
            if entry is not None:
                if entry.digest != digest and (legacy_digest is None or entry.digest != legacy_digest):
                    raise ServiceError("request_conflict")
                if entry.state == "flight":
                    raise ServiceError("request_in_progress")
                if entry.state == "confirmed":
                    outcome = self.cache.get(request_id)
                    if outcome is not None:
                        return Admission(outcome)
                raise ServiceError("request_conflict")
            halt = session.scalars(select(LedgerMeta).where(LedgerMeta.key == "halt")).one()
            if halt.value:
                raise ServiceError("upstream_unavailable")
            active = session.scalars(select(func.count()).select_from(LedgerEntry)
                                     .where(LedgerEntry.state == "flight")).one()
            recent = session.scalars(select(LedgerEntry.admitted).where(LedgerEntry.admitted > now - 60)
                                     .order_by(LedgerEntry.admitted)).all()
            check_rate(self.policy, active, recent, now)
            bucket = int(now // ID_TTL)
            day = session.get(DailyUsage, bucket)
            if day is None:
                day = DailyUsage(bucket=bucket)
                session.add(day)
                session.flush()  # Populate defaults before evaluating budgets.
            check_budget(self.policy, day.requests, day.reserved + day.confirmed + day.uncertain,
                         self.reservation, now)
            session.add(LedgerEntry(id=request_id, digest=digest, admitted=now,
                                    bucket=bucket, state="flight", reservation=self.reservation))
            day.requests += 1
            day.reserved += self.reservation
        return Admission()

    async def settle(self, request_id: str, usage: Usage | None, outcome: Outcome | None,
                     deadline: float | None = None, cancelled: threading.Event | None = None) -> None:
        await self._run(self._terminal, request_id, usage, outcome, deadline, cancelled)

    def _terminal(self, request_id: str, usage: Usage | None, outcome: Outcome | None,
                  deadline: float | None, cancelled: threading.Event | None) -> None:
        with ledger_session(self.db) as session:
            cacheable = self._settle(session, request_id, usage, outcome)
            now = self._now(session)
        # Cache only after successful durable commit and before the caller's
        # deadline. Slow disk cannot turn an already returned timeout into replay.
        if cacheable and outcome is not None:
            self.cache.publish(request_id, outcome, now, deadline, cancelled)

    def _settle(self, session: Session, request_id: str, usage: Usage | None, outcome: Outcome | None) -> bool:
        entry = session.get(LedgerEntry, request_id)
        if entry is None:
            return False
        change = plan_settlement(entry.state, bool(entry.corrected), entry.reservation, usage)
        if change is None:
            return False
        if change.halt:
            halt = session.scalars(select(LedgerMeta).where(LedgerMeta.key == "halt")).one()
            halt.value = 1
        day = session.scalars(select(DailyUsage).where(DailyUsage.bucket == entry.bucket)).one()
        # Python arithmetic preserves exact counters beyond signed64; the mapped
        # ExactTokenCount stores those values without SQLite numeric affinity.
        day.reserved += change.reserved_delta
        day.confirmed += change.confirmed_delta
        day.uncertain += change.uncertain_delta
        day.prompt += change.prompt_delta
        day.completion += change.completion_delta
        entry.state = change.state
        entry.corrected = int(change.corrected)
        # A late correction updates only accounting, never resurrects a response.
        return change.cacheable and outcome is not None and len(outcome.body) <= MAX_RESPONSE_BYTES

    async def maintain(self) -> None:
        await self._run(self._maintenance)

    def _maintenance(self) -> None:
        with ledger_session(self.db) as session:
            self._cleanup(session, self._now(session))
        # DELETE journal + secure_delete wipes reclaimed content; no persistent WAL.
        with self.db.begin():
            self.db.exec_driver_sql("PRAGMA incremental_vacuum")

    async def close(self) -> None:
        def close() -> None:
            with self.lock:
                self.cache.clear()
                try:
                    if hasattr(self, 'db'):
                        self.db.close()
                finally:
                    if self.engine is not None:
                        self.engine.dispose()
        await asyncio.to_thread(close)
