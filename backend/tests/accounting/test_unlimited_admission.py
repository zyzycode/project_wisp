"""Accounting must not enforce the removed local request or token quotas."""

import asyncio
import sqlite3
from contextlib import closing
from pathlib import Path

import pytest
from tests.helpers import Clock
from wisp_backend.accounting.contracts import Admission
from wisp_backend.accounting.sqlite_ledger import SQLiteLedger
from wisp_backend.config.profiles import PROFILES
from wisp_backend.errors import ServiceError


@pytest.mark.parametrize("provider", ["gemini", "openai"])
def test_requests_exceed_all_former_quotas_and_survive_restart(tmp_path: Path, provider: str) -> None:
    async def run() -> None:
        path = tmp_path / "unlimited.sqlite"
        clock = Clock()
        reservation = PROFILES[provider].reservation
        ledger = await SQLiteLedger.open(path, clock, reservation=reservation)
        try:
            # Same instant, >100 daily calls, >12/minute, >2 in flight and a
            # combined reservation larger than either provider's old daily cap.
            results = await asyncio.gather(*(ledger.admit(str(i), "digest") for i in range(105)))
            assert all(result == Admission() for result in results)
            with pytest.raises(ServiceError, match="request_in_progress"):
                await ledger.admit("0", "digest")
        finally:
            await ledger.close()
        # Restart converts all unfinished calls to uncertain usage; none of it
        # prevents another request, including when a legacy quota halt persists.
        with closing(sqlite3.connect(path)) as db, db:
            db.execute("INSERT OR REPLACE INTO meta VALUES ('halt', 1)")
        ledger = await SQLiteLedger.open(path, clock, reservation=reservation)
        try:
            assert await ledger.admit("next", "digest") == Admission()
            with pytest.raises(ServiceError, match="request_conflict"):
                await ledger.admit("0", "digest")
            with closing(sqlite3.connect(path)) as db:
                assert db.execute("SELECT requests,reserved,uncertain FROM days").fetchone() == (
                    106,
                    reservation,
                    105 * reservation,
                )
        finally:
            await ledger.close()

    asyncio.run(run())
