"""Connection, operation-scoped ORM sessions and schema initialization for SQLite."""

import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.engine import URL, Connection, Engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import ConnectionPoolEntry, NullPool
from wisp_backend.accounting.models import Base


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
        poolclass=NullPool,
        echo=False,
        hide_parameters=True,
    )
    event.listen(engine, "connect", _configure_connection)
    event.listen(engine, "begin", _begin)
    return engine


def initialize_schema(connection: Connection) -> None:
    """Create missing tables.

    The caller owns the encompassing transaction. Existing tables and counters
    are never rebuilt or reset during startup.
    """
    Base.metadata.create_all(connection)


@contextmanager
def ledger_session(connection: Connection) -> Iterator[Session]:
    """One unit of work per serialized operation.

    The Session owns commit/rollback and is always closed before returning.
    The ledger retains ownership of its externally supplied Connection. No ORM
    instances or identity map survive into another operation or worker thread.
    """
    with Session(bind=connection, autobegin=False) as session, session.begin():
        yield session
