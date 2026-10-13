"""Changing providers must preserve durable accounting and replay protection."""
import asyncio
import sqlite3

import pytest

from wisp_backend.config import LedgerSettings
from wisp_backend.contracts import RESERVATION, Usage
from wisp_backend.errors import ServiceError
from wisp_backend.ledger import SQLiteLedger
from wisp_backend.providers.profiles import PROFILES
from tests.test_ledger import Clock

GEMINI = PROFILES["gemini"].reservation


@pytest.mark.parametrize("first,second", [(RESERVATION, GEMINI), (GEMINI, RESERVATION)])
def test_crash_switch_and_late_correction_use_original_reservation(tmp_path, first, second):
    async def run():
        path = tmp_path / "ledger.sqlite"
        policy = LedgerSettings(daily_tokens=4_000_000)
        ledger = await SQLiteLedger.open(path, policy, reservation=first)
        await ledger.admit("old", "digest")
        await ledger.close()
        ledger = await SQLiteLedger.open(path, policy, reservation=second)
        with sqlite3.connect(path) as db:
            assert db.execute("SELECT reserved,uncertain FROM days").fetchone() == (0, first)
        with pytest.raises(ServiceError, match="request_conflict"):
            await ledger.admit("old", "digest")
        await ledger.admit("new", "digest2")
        await ledger.settle("old", Usage(5, 2, 7), None)
        await ledger.settle("old", Usage(100, 2, 102), None)
        await ledger.settle("new", None, None)
        await ledger.close()
        with sqlite3.connect(path) as db:
            assert db.execute("SELECT requests,reserved,confirmed,uncertain FROM days").fetchone() == (2, 0, 7, second)
            assert db.execute("SELECT reservation FROM entries ORDER BY id").fetchall() == [(second,), (first,)]
    asyncio.run(run())


def test_migration_of_old_schema_before_crash_recovery(tmp_path):
    async def run():
        path = tmp_path / "legacy.sqlite"
        clock = Clock()
        with sqlite3.connect(path) as db:
            db.executescript('''
                CREATE TABLE entries (id TEXT PRIMARY KEY, digest TEXT NOT NULL, admitted REAL NOT NULL,
                    bucket INTEGER NOT NULL, state TEXT NOT NULL, corrected INTEGER NOT NULL DEFAULT 0);
                CREATE TABLE days (bucket INTEGER PRIMARY KEY, requests INTEGER NOT NULL DEFAULT 0,
                    reserved INTEGER NOT NULL DEFAULT 0, confirmed NOT NULL DEFAULT 0,
                    uncertain INTEGER NOT NULL DEFAULT 0, prompt NOT NULL DEFAULT 0, completion NOT NULL DEFAULT 0);
            ''')
            bucket = int(clock.now // 86400)
            db.execute("INSERT INTO entries(id,digest,admitted,bucket,state) VALUES ('old','digest',?,?,'flight')", (clock.now, bucket))
            db.execute("INSERT INTO days(bucket,requests,reserved) VALUES (?,1,?)", (bucket, RESERVATION))
        policy = LedgerSettings(daily_tokens=2_000_000)
        ledger = await SQLiteLedger.open(path, policy, clock, reservation=GEMINI)
        await ledger.admit("new", "digest2")
        await ledger.close()
        with sqlite3.connect(path) as db:
            assert db.execute("SELECT reserved,uncertain FROM days").fetchone() == (GEMINI, RESERVATION)
            assert db.execute("SELECT reservation,state FROM entries WHERE id='old'").fetchone() == (RESERVATION, "uncertain")
    asyncio.run(run())


def test_gemini_budget_boundary_and_usage_overflow_latch(tmp_path):
    async def run():
        path = tmp_path / "ledger.sqlite"
        policy = LedgerSettings(daily_tokens=GEMINI)
        ledger = await SQLiteLedger.open(path, policy, reservation=GEMINI)
        await ledger.admit("one", "digest")
        with pytest.raises(ServiceError, match="budget_exhausted"):
            await ledger.admit("two", "other")
        await ledger.settle("one", Usage(GEMINI, 1, GEMINI + 1), None)
        await ledger.close()
        ledger = await SQLiteLedger.open(path, LedgerSettings(daily_tokens=4_000_000))
        with pytest.raises(ServiceError, match="upstream_unavailable"):
            await ledger.admit("three", "other")
        await ledger.close()
    asyncio.run(run())
