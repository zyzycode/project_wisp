"""Small stdlib adapter: static event names, lazy fields and scoped operations."""

import logging
import sys
import uuid
from collections.abc import Callable, Iterator, Mapping
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Any

from wisp_backend.logging.fields import TOKEN, safe_error, safe_fields

_context: ContextVar[dict[str, Any]] = ContextVar("wisp_log_context", default={})


@dataclass(frozen=True)
class EventRecord:
    data: dict[str, Any]


@contextmanager
def log_context(**fields: object) -> Iterator[None]:
    """Generate a server-owned correlation ID once; never trust a caller's ID."""
    context = {**_context.get(), **safe_fields(fields)}
    context.setdefault("correlation_id", uuid.uuid4().hex)
    token = _context.set(context)
    try:
        yield
    finally:
        _context.reset(token)


class EventLogger(logging.LoggerAdapter):
    def log(self, level: int, msg: str, *args: object, **kwargs: Any) -> None:
        if not self.isEnabledFor(level):
            return
        fields: Mapping[str, object] | Callable[[], Mapping[str, object]] = kwargs.pop("fields", {})
        error = kwargs.pop("error", None)
        if kwargs.pop("exc_info", False) and error is None:
            error = sys.exception()
        event = msg if type(msg) is str and TOKEN.fullmatch(msg) and not args else "invalid_event"
        data = {
            "event": event,
            "fields": safe_fields(fields() if callable(fields) else fields),
            "context": dict(_context.get()),
        }
        if isinstance(error, BaseException):
            data["error"] = safe_error(error)
        self.logger.log(level, event, extra={"wisp_event": EventRecord(data)}, stacklevel=2)


def get_logger(name: str) -> EventLogger:
    """Names and events are source-code constants, never interpolated user input."""
    return EventLogger(logging.getLogger(name), {})
