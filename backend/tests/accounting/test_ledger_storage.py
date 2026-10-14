"""Storage compatibility and transaction guarantees independent of the SQL adapter."""

import asyncio
from contextlib import closing
from pathlib import Path
import sqlite3

import pytest
from sqlalchemy import event
from sqlalchemy.engine import Connection, Engine

from wisp_backend.accounting.contracts import RESERVATION, Usage
from wisp_backend.accounting.sqlite_ledger import SQLiteLedger
import wisp_backend.accounting.sqlite_ledger as ledger_module
from wisp_backend.errors import ServiceError
from wisp_backend.outcomes import Outcome


NOW = 1_800_000_000.0


def test_existing_typeless_counters_survive_open_correction_and_restart(tmp_path: Path) -> None:
    path = tmp_path / "existing.sqlite"
    huge = 10**100
    bucket = int(NOW // 86_400)
    with closing(sqlite3.connect(path)) as db, db:
        db.executescript('''
            CREATE TABLE meta (key TEXT PRIMARY KEY, value REAL NOT NULL);
            CREATE TABLE days (bucket INTEGER PRIMARY KEY, requests INTEGER NOT NULL DEFAULT 0,
                reserved INTEGER NOT NULL DEFAULT 0, confirmed NOT NULL DEFAULT 0,
                uncertain INTEGER NOT NULL DEFAULT 0, prompt NOT NULL DEFAULT 0,
                completion NOT NULL DEFAULT 0);
            CREATE TABLE entries (id TEXT PRIMARY KEY, digest TEXT NOT NULL, admitted REAL NOT NULL,
                bucket INTEGER NOT NULL, state TEXT NOT NULL, corrected INTEGER NOT NULL DEFAULT 0,
                reservation INTEGER NOT NULL DEFAULT 131072);
        ''')
        db.executemany("INSERT INTO meta VALUES (?, ?)", [("clock", NOW), ("halt", 1)])
        db.execute("INSERT INTO days VALUES (?,1,0,?,?,?,0)", (bucket, str(huge), RESERVATION, str(huge)))
        db.execute("INSERT INTO entries VALUES ('old','digest',?,?,'uncertain',0,?)",
                   (NOW, bucket, RESERVATION))

    async def run() -> None:
        for index in range(2):
            ledger = await SQLiteLedger.open(path, lambda: NOW)
            try:
                await ledger.settle("old", Usage(5, 2, 7), None)
                await ledger.admit(f"new-{index}", "new-digest")
                await ledger.settle(f"new-{index}", Usage(0, 0, 0), None)
                with pytest.raises(ServiceError, match="request_conflict"):
                    await ledger.admit("old", "digest")
            finally:
                await ledger.close()

    asyncio.run(run())
    with closing(sqlite3.connect(path)) as db, db:
        row = db.execute("SELECT requests,reserved,confirmed,uncertain,prompt,completion FROM days").fetchone()
        assert tuple(map(int, row)) == (3, 0, huge + 7, 0, huge + 5, 2)
        assert db.execute("SELECT state,corrected,reservation FROM entries WHERE id='old'").fetchone() == (
            "confirmed", 1, RESERVATION)
        assert db.execute("SELECT value FROM meta WHERE key='halt'").fetchone()[0] == 1


def test_connection_safeguards_and_fresh_counter_types(tmp_path: Path) -> None:
    async def run() -> None:
        path = tmp_path / "settings.sqlite"
        ledger = await SQLiteLedger.open(path)

        def read_pragmas() -> tuple[object, ...]:
            with ledger.db.begin():
                return tuple(ledger.db.exec_driver_sql(f"PRAGMA {name}").scalar_one()
                             for name in ("secure_delete", "journal_mode", "synchronous"))

        try:
            assert await ledger._run(read_pragmas) == (1, "delete", 2)
            await ledger.admit("one", "digest")
        finally:
            await ledger.close()
        with closing(sqlite3.connect(path)) as db, db:
            column_types = {row[1]: row[2] for row in db.execute("PRAGMA table_info(days)")}
            assert [column_types[name] for name in ("confirmed", "prompt", "completion")] == ["", "", ""]
            assert db.execute("SELECT typeof(confirmed),typeof(prompt),typeof(completion) FROM days").fetchone() == (
                "integer", "integer", "integer")

    asyncio.run(run())


def test_failed_startup_rolls_back_schema_and_closes_engine(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    path = tmp_path / "failed-startup.sqlite"
    connections: list[Connection] = []
    disposed: list[Engine] = []
    create_engine = ledger_module.create_ledger_engine
    initialize_schema = ledger_module.initialize_schema

    def tracked_engine(path: Path) -> Engine:
        engine = create_engine(path)
        event.listen(engine, "engine_disposed", disposed.append)
        return engine

    def fail_after_schema(connection: Connection) -> None:
        connections.append(connection)
        initialize_schema(connection)
        connection.exec_driver_sql("SELECT * FROM missing_startup_table")

    monkeypatch.setattr(ledger_module, "create_ledger_engine", tracked_engine)
    monkeypatch.setattr(ledger_module, "initialize_schema", fail_after_schema)

    async def run() -> None:
        with pytest.raises(ServiceError, match="^upstream_unavailable$"):
            await SQLiteLedger.open(path)

    asyncio.run(run())
    assert len(connections) == len(disposed) == 1
    assert connections[0].closed
    with closing(sqlite3.connect(path)) as db, db:
        assert db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall() == []
    path.unlink()


def test_failed_settlement_rolls_back_usage_and_does_not_publish_cache(tmp_path: Path) -> None:
    async def run() -> None:
        path = tmp_path / "rollback.sqlite"
        ledger = await SQLiteLedger.open(path)
        try:
            await ledger.admit("one", "digest")
            with closing(sqlite3.connect(path)) as db, db:
                db.execute('''CREATE TRIGGER fail_settlement BEFORE UPDATE OF confirmed ON days
                    BEGIN SELECT RAISE(ABORT, 'synthetic storage failure'); END''')
            with pytest.raises(ServiceError, match="upstream_unavailable"):
                await ledger.settle("one", Usage(RESERVATION, 1, RESERVATION + 1), Outcome(200, b'{}'))
            assert "one" not in ledger.cache
            with closing(sqlite3.connect(path)) as db, db:
                assert db.execute("SELECT reserved,confirmed,uncertain FROM days").fetchone() == (RESERVATION, 0, 0)
                assert db.execute("SELECT state FROM entries").fetchone()[0] == "flight"
                db.execute("DROP TRIGGER fail_settlement")
        finally:
            await ledger.close()
        recovered = await SQLiteLedger.open(path)
        await recovered.close()
        with closing(sqlite3.connect(path)) as db, db:
            assert db.execute("SELECT reserved,uncertain FROM days").fetchone() == (0, RESERVATION)

    asyncio.run(run())


def test_connection_failure_disposes_engine(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    path = tmp_path / "directory-is-not-a-database"
    path.mkdir()
    disposed: list[Engine] = []
    create_engine = ledger_module.create_ledger_engine

    def tracked_engine(path: Path) -> Engine:
        engine = create_engine(path)
        event.listen(engine, "engine_disposed", disposed.append)
        return engine

    monkeypatch.setattr(ledger_module, "create_ledger_engine", tracked_engine)

    async def run() -> None:
        with pytest.raises(ServiceError, match="^upstream_unavailable$"):
            await SQLiteLedger.open(path)

    asyncio.run(run())
    assert len(disposed) == 1


def test_close_releases_database_file(tmp_path: Path) -> None:
    async def run() -> None:
        path = tmp_path / "closed.sqlite"
        ledger = await SQLiteLedger.open(path)
        await ledger.close()
        await ledger.close()
        path.unlink()
        assert not path.exists()

    asyncio.run(run())
