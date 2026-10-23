"""Safe stdlib formatting and synchronous stderr output."""

import json
import logging
import sys
from datetime import datetime, timezone
from typing import TextIO

from wisp_backend.logging import EventRecord
from wisp_backend.logging_config import LEVELS, LoggingSettings
from wisp_backend.logging_fields import TOKEN


class SafeFormatter(logging.Formatter):
    def __init__(self, mode: str) -> None:
        super().__init__()
        self.mode = mode

    def format(self, record: logging.LogRecord) -> str:
        # Arbitrary library msg/args/exc_info/extra must never reach formatting.
        data = getattr(record, "wisp_event", None)
        data = data.data if isinstance(data, EventRecord) else {"event": "external_log", "context": {}, "fields": {}}
        module = (
            record.name
            if TOKEN.fullmatch(record.name)
            and record.name.split(".")[0] in {"wisp_backend", "uvicorn", "httpx", "httpcore", "tests"}
            else "external"
        )
        if module.split(".")[0] in {"uvicorn", "httpx", "httpcore"}:
            module = module.split(".")[0]
        envelope = {
            "timestamp": datetime.fromtimestamp(record.created, timezone.utc).isoformat(timespec="milliseconds"),
            "level": logging.getLevelName(record.levelno),
            "module": module,
            **data,
        }
        if self.mode == "json":
            return json.dumps(envelope, ensure_ascii=True, separators=(",", ":"))
        details = {key: value for key, value in data.items() if key != "event"}
        return f"{envelope['timestamp']} {envelope['level']:<8} {module} {data['event']} " + json.dumps(
            details, ensure_ascii=True, separators=(",", ":")
        )


class SafeStreamHandler(logging.StreamHandler):
    def handleError(self, record: logging.LogRecord) -> None:
        # Stdlib's diagnostic would print raw exception messages and record args.
        # Output is best effort: do not recurse into logging on a broken stderr.
        pass


def configure_logging(settings: LoggingSettings, output: TextIO | None = None) -> logging.Handler:
    handler = SafeStreamHandler(output if output is not None else sys.stderr)
    handler.setFormatter(SafeFormatter(settings.format))
    logging.basicConfig(handlers=[handler], level=LEVELS[settings.level], force=True)
    for candidate in list(logging.Logger.manager.loggerDict.values()):
        if isinstance(candidate, logging.Logger):
            candidate.handlers.clear()
            candidate.propagate = True
            candidate.disabled = False
            candidate.setLevel(logging.NOTSET)
    for name in list(logging.Logger.manager.loggerDict):
        root_name = name.split(".")[0]
        if root_name not in {"wisp_backend", "uvicorn", "tests"}:
            logging.getLogger(root_name).setLevel(max(LEVELS[settings.level], logging.WARNING))
    for name, level in settings.overrides.items():
        logging.getLogger(name).setLevel(LEVELS[level])
    return handler
