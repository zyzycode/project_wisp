"""SQLAlchemy tables and connection policy for the existing SQLite ledger files."""
import sqlite3
from collections.abc import Callable
from pathlib import Path
from typing import Any

from sqlalchemy import Column, Integer, MetaData, REAL, Table, Text, create_engine, event, inspect, text
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.engine import Connection, Dialect, Engine, URL
from sqlalchemy.pool import ConnectionPoolEntry, NullPool
from sqlalchemy.types import UserDefinedType

from wisp_backend.contracts import RESERVATION


class ExactTokenCount(UserDefinedType[int]):
    """Preserve typeless SQLite counters, including integers larger than signed64.

    A numeric affinity would turn decimal strings into imprecise REAL values.
    These columns deliberately retain the legacy empty declared type; arithmetic
    is performed in Python and only the final exact value is bound to SQLite.
    """
    cache_ok = True

    def get_col_spec(self, **kw: Any) -> str:
        return ""

    def bind_processor(self, dialect: Dialect) -> Callable[[int], int | str]:
        return lambda value: value if value <= 2**63 - 1 else str(value)

    def result_processor(self, dialect: Dialect, coltype: object) -> Callable[[int | str], int]:
        return int


metadata = MetaData()
meta = Table(
    "meta", metadata,
    Column("key", Text, primary_key=True, nullable=True),
    Column("value", REAL, nullable=False),
)
days = Table(
    "days", metadata,
    Column("bucket", Integer, primary_key=True),
    Column("requests", Integer, nullable=False, server_default=text("0")),
    Column("reserved", Integer, nullable=False, server_default=text("0")),
    Column("confirmed", ExactTokenCount(), nullable=False, server_default=text("0")),
    Column("uncertain", Integer, nullable=False, server_default=text("0")),
    Column("prompt", ExactTokenCount(), nullable=False, server_default=text("0")),
    Column("completion", ExactTokenCount(), nullable=False, server_default=text("0")),
)
entries = Table(
    "entries", metadata,
    Column("id", Text, primary_key=True, nullable=True),
    Column("digest", Text, nullable=False),
    Column("admitted", REAL, nullable=False),
    Column("bucket", Integer, nullable=False),
    Column("state", Text, nullable=False),
    Column("corrected", Integer, nullable=False, server_default=text("0")),
    Column("reservation", Integer, nullable=False, server_default=text(str(RESERVATION))),
)


def _configure_connection(dbapi_connection: sqlite3.Connection, record: ConnectionPoolEntry) -> None:
    # SQLAlchemy owns BEGIN on every supported Python version, including 3.10.
    dbapi_connection.isolation_level = None
    cursor = dbapi_connection.cursor()
    try:
        cursor.execute("PRAGMA secure_delete=ON")
        cursor.execute("PRAGMA journal_mode=DELETE")
        cursor.execute("PRAGMA synchronous=FULL")
    finally:
        cursor.close()


def _begin(connection: Connection) -> None:
    connection.exec_driver_sql("BEGIN")


def create_ledger_engine(path: Path) -> Engine:
    """Keep one checked-out connection; never retain another in a pool."""
    engine = create_engine(
        URL.create("sqlite+pysqlite", database=str(path)),
        connect_args={"timeout": 0.25, "check_same_thread": False},
        poolclass=NullPool, echo=False, hide_parameters=True,
    )
    event.listen(engine, "connect", _configure_connection)
    event.listen(engine, "begin", _begin)
    return engine


def initialize_schema(connection: Connection) -> None:
    """Create missing tables and upgrade legacy reservation before crash recovery.

    The caller owns the encompassing transaction. Existing tables and counters
    are never rebuilt or reset during startup.
    """
    metadata.create_all(connection)
    connection.execute(insert(meta).values([
        {"key": "clock", "value": 0}, {"key": "halt", "value": 0},
    ]).on_conflict_do_nothing())
    columns = {column["name"] for column in inspect(connection).get_columns("entries")}
    if "reservation" not in columns:
        connection.exec_driver_sql("ALTER TABLE entries ADD COLUMN reservation INTEGER NOT NULL DEFAULT 131072")
