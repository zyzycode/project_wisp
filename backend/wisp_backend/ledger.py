"""One-worker durable admission using SQLAlchemy Core outside the event loop."""
import asyncio
import math
import threading
import time
from collections import OrderedDict
from pathlib import Path
from typing import Callable, ParamSpec, TypeVar

from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.exc import SQLAlchemyError

from wisp_backend.config import LedgerSettings
from wisp_backend.contracts import Admission, Outcome, RESERVATION, Usage
from wisp_backend.errors import ServiceError
from wisp_backend.ledger_storage import create_ledger_engine, days, entries, initialize_schema, meta

OperationArgs = ParamSpec("OperationArgs")
OperationResult = TypeVar("OperationResult")

ID_TTL = 86_400
CACHE_TTL = 600


class SQLiteLedger:
    def __init__(self, path: Path, policy: LedgerSettings, clock: Callable[[], float],
                 reservation: int = RESERVATION) -> None:
        self.path, self.policy, self.clock = path, policy, clock
        self.reservation = reservation
        self.lock = threading.Lock()
        self.cache: OrderedDict[str, tuple[float, Outcome, threading.Event | None]] = OrderedDict()
        self.failed = False
        self.engine: Engine | None = None
        self.db: Connection

    @classmethod
    async def open(cls, path: Path, policy: LedgerSettings,
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
        with self.db.begin():
            initialize_schema(self.db)
            for request_id in self.db.scalars(select(entries.c.id).where(entries.c.state == "flight")).all():
                self._settle(request_id, None, None)
            self._cleanup(self._now())

    def _now(self) -> float:
        now = max(self.clock(), self.db.execute(select(meta.c.value).where(meta.c.key == "clock")).scalar_one())
        self.db.execute(update(meta).where(meta.c.key == "clock").values(value=now))
        return now

    def _cleanup(self, now: float) -> None:
        self.db.execute(delete(entries).where(entries.c.admitted <= now - ID_TTL, entries.c.state != "flight"))
        self.db.execute(delete(days).where(days.c.bucket <= int(now // ID_TTL) - 30))
        for key, (created, _, _) in list(self.cache.items()):
            if created + CACHE_TTL <= now:
                del self.cache[key]

    async def admit(self, request_id: str, digest: str, legacy_digest: str | None = None) -> Admission:
        return await self._run(self._admit, request_id, digest, legacy_digest)

    def _admit(self, request_id: str, digest: str, legacy_digest: str | None) -> Admission:
        # A single process lock plus SQLite transaction covers every admission decision.
        with self.db.begin():
            now = self._now()
            self._cleanup(now)
            row = self.db.execute(select(entries).where(entries.c.id == request_id)).mappings().first()
            if row:
                if row['digest'] != digest and (legacy_digest is None or row['digest'] != legacy_digest):
                    raise ServiceError("request_conflict")
                if row['state'] == 'flight':
                    raise ServiceError("request_in_progress")
                if row['state'] == 'confirmed' and request_id in self.cache:
                    _, outcome, cancelled = self.cache[request_id]
                    if cancelled is None or not cancelled.is_set():
                        return Admission(outcome)
                    del self.cache[request_id]
                raise ServiceError("request_conflict")
            if self.db.execute(select(meta.c.value).where(meta.c.key == "halt")).scalar_one():
                raise ServiceError("upstream_unavailable")
            active = self.db.execute(select(func.count()).select_from(entries).where(entries.c.state == "flight")).scalar_one()
            recent = self.db.scalars(select(entries.c.admitted).where(entries.c.admitted > now - 60)
                                    .order_by(entries.c.admitted)).all()
            if active >= self.policy.concurrent_limit:
                raise ServiceError("rate_limited", 1000)
            if len(recent) >= self.policy.rate_limit:
                raise ServiceError("rate_limited", max(1, math.ceil((recent[0] + 60 - now) * 1000)))
            bucket = int(now // ID_TTL)
            self.db.execute(insert(days).values(bucket=bucket).on_conflict_do_nothing())
            day = self.db.execute(select(days).where(days.c.bucket == bucket)).mappings().one()
            if (day['requests'] >= self.policy.daily_requests or
                    day['reserved'] + int(day['confirmed']) + day['uncertain'] + self.reservation > self.policy.daily_tokens):
                raise ServiceError("budget_exhausted", max(1, math.ceil(((bucket + 1) * ID_TTL - now) * 1000)))
            self.db.execute(insert(entries).values(id=request_id, digest=digest, admitted=now,
                                                  bucket=bucket, state="flight", reservation=self.reservation))
            self.db.execute(update(days).where(days.c.bucket == bucket).values(
                requests=days.c.requests + 1, reserved=days.c.reserved + self.reservation))
        return Admission()

    async def settle(self, request_id: str, usage: Usage | None, outcome: Outcome | None,
                     deadline: float | None = None, cancelled: threading.Event | None = None) -> None:
        await self._run(self._terminal, request_id, usage, outcome, deadline, cancelled)

    def _terminal(self, request_id: str, usage: Usage | None, outcome: Outcome | None,
                  deadline: float | None, cancelled: threading.Event | None) -> None:
        with self.db.begin():
            cacheable = self._settle(request_id, usage, outcome)
            now = self._now()
        # Cache only after successful durable commit and before the caller's
        # deadline. Slow disk cannot turn an already returned timeout into replay.
        if (cacheable and outcome and (deadline is None or time.monotonic() < deadline)
                and (cancelled is None or not cancelled.is_set())):
            self.cache[request_id] = (now, outcome, cancelled)
            while len(self.cache) > 100:
                self.cache.popitem(last=False)

    def _settle(self, request_id: str, usage: Usage | None, outcome: Outcome | None) -> bool:
        row = self.db.execute(select(entries).where(entries.c.id == request_id)).mappings().first()
        if not row or row['state'] == 'confirmed' or row['corrected']:
            return False
        if row['state'] == 'uncertain' and usage is None:
            return False
        reservation = row['reservation']
        if usage and usage.total > reservation:
            self.db.execute(update(meta).where(meta.c.key == "halt").values(value=1))
        reserved_delta = -reservation if row['state'] == 'flight' else 0
        uncertain_delta = (0 if usage else reservation) - (reservation if row['state'] == 'uncertain' else 0)
        day = self.db.execute(select(days).where(days.c.bucket == row['bucket'])).mappings().one()
        # ExactTokenCount binds huge integers as decimal strings without numeric affinity.
        self.db.execute(update(days).where(days.c.bucket == row['bucket']).values(
            reserved=days.c.reserved + reserved_delta,
            confirmed=day['confirmed'] + (usage.total if usage else 0),
            uncertain=days.c.uncertain + uncertain_delta,
            prompt=day['prompt'] + (usage.prompt if usage else 0),
            completion=day['completion'] + (usage.completion if usage else 0)))
        state = 'confirmed' if usage else 'uncertain'
        self.db.execute(update(entries).where(entries.c.id == request_id).values(
            state=state, corrected=int(row['state'] == 'uncertain')))
        # A late correction updates only accounting, never resurrects a response.
        return row['state'] == 'flight' and usage is not None and outcome is not None and len(outcome.body) <= 16 * 1024

    async def maintain(self) -> None:
        await self._run(self._maintenance)

    def _maintenance(self) -> None:
        with self.db.begin():
            self._cleanup(self._now())
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
