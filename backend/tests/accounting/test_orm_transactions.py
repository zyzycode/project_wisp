"""ORM unit-of-work guarantees at the existing SQLite boundary."""

import asyncio
from contextlib import closing
from pathlib import Path
import sqlite3

import pytest
from sqlalchemy import event, inspect
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from wisp_backend.accounting.contracts import RESERVATION, Usage
from wisp_backend.accounting.models import DailyUsage, LedgerEntry
from wisp_backend.accounting.sqlite_ledger import SQLiteLedger
from wisp_backend.accounting.storage import ledger_session
from wisp_backend.config.settings import LedgerSettings
from wisp_backend.errors import ServiceError
from wisp_backend.outcomes import Outcome


def test_sessions_detach_models_and_rollback_dirty_state(tmp_path: Path) -> None:
    async def run() -> None:
        ledger = await SQLiteLedger.open(tmp_path / "sessions.sqlite", LedgerSettings())
        try:
            await ledger.admit("one", "digest")

            def check_sessions() -> None:
                with ledger_session(ledger.db) as session:
                    entry = session.get(LedgerEntry, "one")
                    assert entry is not None and inspect(entry).persistent
                    bucket = entry.bucket
                assert inspect(entry).detached
                with pytest.raises(ServiceError):
                    with ledger_session(ledger.db) as session:
                        day = session.get(DailyUsage, bucket)
                        assert day is not None
                        day.confirmed = 10**100
                        session.flush()
                        raise ServiceError("budget_exhausted")
                with ledger_session(ledger.db) as session:
                    fresh = session.get(LedgerEntry, "one")
                    day = session.get(DailyUsage, bucket)
                    assert fresh is not None and fresh is not entry
                    assert day is not None and day.confirmed == 0
                    assert day.reserved == RESERVATION
                assert not ledger.db.in_transaction()

            await ledger._run(check_sessions)
            await ledger.settle("one", Usage(2, 3, 5), Outcome(200, b"{}"))
            assert (await ledger.admit("one", "digest")).replay == Outcome(200, b"{}")
        finally:
            await ledger.close()

    asyncio.run(run())


def test_commit_failure_never_publishes_replay(tmp_path: Path) -> None:
    path = tmp_path / "commit.sqlite"

    def fail_commit(connection: object) -> None:
        raise SQLAlchemyError("synthetic commit failure")

    async def run() -> None:
        ledger = await SQLiteLedger.open(path, LedgerSettings())
        try:
            await ledger.admit("one", "digest")
            event.listen(ledger.engine, "commit", fail_commit)
            with pytest.raises(ServiceError, match="^upstream_unavailable$"):
                await ledger.settle("one", Usage(2, 3, 5), Outcome(200, b"{}"))
            assert "one" not in ledger.cache
            assert ledger.failed
        finally:
            event.remove(ledger.engine, "commit", fail_commit)
            await ledger.close()
        with closing(sqlite3.connect(path)) as db:
            assert db.execute("SELECT state FROM entries").fetchone() == ("flight",)
            assert db.execute("SELECT reserved,confirmed FROM days").fetchone() == (RESERVATION, 0)
        recovered = await SQLiteLedger.open(path, LedgerSettings())
        await recovered.close()
        with closing(sqlite3.connect(path)) as db:
            assert db.execute("SELECT reserved,uncertain FROM days").fetchone() == (0, RESERVATION)

    asyncio.run(run())


def test_recovery_failure_rolls_back_previously_flushed_entries(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    path = tmp_path / "recovery.sqlite"
    settle = SQLiteLedger._settle
    calls = 0

    def fail_second(self: SQLiteLedger, session: Session, request_id: str,
                    usage: Usage | None, outcome: Outcome | None) -> bool:
        nonlocal calls
        calls += 1
        if calls == 2:
            session.flush()
            raise SQLAlchemyError("synthetic recovery failure")
        return settle(self, session, request_id, usage, outcome)

    async def run() -> None:
        ledger = await SQLiteLedger.open(path, LedgerSettings())
        await ledger.admit("one", "one")
        await ledger.admit("two", "two")
        await ledger.close()
        with monkeypatch.context() as patch:
            patch.setattr(SQLiteLedger, "_settle", fail_second)
            with pytest.raises(ServiceError, match="^upstream_unavailable$"):
                await SQLiteLedger.open(path, LedgerSettings())
        with closing(sqlite3.connect(path)) as db:
            assert db.execute("SELECT state FROM entries").fetchall() == [("flight",), ("flight",)]
            assert db.execute("SELECT reserved,uncertain FROM days").fetchone() == (2 * RESERVATION, 0)
        recovered = await SQLiteLedger.open(path, LedgerSettings())
        await recovered.close()
        with closing(sqlite3.connect(path)) as db:
            assert db.execute("SELECT reserved,uncertain FROM days").fetchone() == (0, 2 * RESERVATION)

    asyncio.run(run())
