"""Changing providers must preserve durable accounting and replay protection."""

import asyncio
import sqlite3

import pytest
from wisp_backend.accounting.contracts import RESERVATION, Usage
from wisp_backend.accounting.sqlite_ledger import SQLiteLedger
from wisp_backend.config.profiles import PROFILES
from wisp_backend.errors import ServiceError

GEMINI = PROFILES["gemini"].reservation


@pytest.mark.parametrize("first,second", [(RESERVATION, GEMINI), (GEMINI, RESERVATION)])
def test_crash_switch_and_late_correction_use_original_reservation(tmp_path, first, second):
    async def run():
        path = tmp_path / "ledger.sqlite"
        ledger = await SQLiteLedger.open(path, reservation=first)
        await ledger.admit("old", "digest")
        await ledger.close()
        ledger = await SQLiteLedger.open(path, reservation=second)
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


def test_gemini_large_usage_and_restart_do_not_block_admission(tmp_path):
    async def run():
        path = tmp_path / "ledger.sqlite"
        ledger = await SQLiteLedger.open(path, reservation=GEMINI)
        await ledger.admit("one", "digest")
        await ledger.admit("two", "other")
        await ledger.settle("one", Usage(GEMINI, 1, GEMINI + 1), None)
        await ledger.close()
        ledger = await SQLiteLedger.open(path)
        await ledger.admit("three", "other")
        await ledger.close()

    asyncio.run(run())
