"""ORM models mapped to the existing ledger schema; never cross the storage port."""
from collections.abc import Callable
from typing import Any

from sqlalchemy import Integer, REAL, Text, text
from sqlalchemy.engine import Dialect
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.types import UserDefinedType

from wisp_backend.accounting.contracts import RESERVATION


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


class Base(DeclarativeBase):
    pass


class LedgerMeta(Base):
    __tablename__ = "meta"

    # Legacy SQLite TEXT primary keys were declared nullable. Keep the on-disk DDL.
    key: Mapped[str] = mapped_column(Text, primary_key=True, nullable=True)
    value: Mapped[float] = mapped_column(REAL, nullable=False)


class DailyUsage(Base):
    __tablename__ = "days"

    bucket: Mapped[int] = mapped_column(Integer, primary_key=True)
    requests: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    reserved: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    confirmed: Mapped[int] = mapped_column(ExactTokenCount(), default=0, server_default=text("0"))
    uncertain: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    prompt: Mapped[int] = mapped_column(ExactTokenCount(), default=0, server_default=text("0"))
    completion: Mapped[int] = mapped_column(ExactTokenCount(), default=0, server_default=text("0"))


class LedgerEntry(Base):
    __tablename__ = "entries"

    id: Mapped[str] = mapped_column(Text, primary_key=True, nullable=True)
    digest: Mapped[str] = mapped_column(Text)
    admitted: Mapped[float] = mapped_column(REAL)
    bucket: Mapped[int] = mapped_column(Integer)
    state: Mapped[str] = mapped_column(Text)
    corrected: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    reservation: Mapped[int] = mapped_column(Integer, default=RESERVATION, server_default=text(str(RESERVATION)))
