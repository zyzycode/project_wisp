"""Central formatting and bounded best-effort output, isolated from request threads."""

import json
import logging
import queue
import sys
import threading
from datetime import datetime, timezone
from typing import Any, TextIO

from wisp_backend.logging import EventRecord
from wisp_backend.logging_config import LEVELS, LoggingSettings
from wisp_backend.logging_fields import TOKEN

_active: "LogRuntime | None" = None


def format_record(record: dict[str, Any], mode: str) -> str:
    if mode == "json":
        return json.dumps(record, ensure_ascii=True, separators=(",", ":"))
    details = {key: value for key, value in record.items() if key not in {"timestamp", "level", "module", "event"}}
    return f"{record['timestamp']} {record['level']:<8} {record['module']} {record['event']} " + json.dumps(
        details, ensure_ascii=True, separators=(",", ":")
    )


class SafeHandler(logging.Handler):
    def __init__(self, owner: "LogRuntime") -> None:
        super().__init__()
        self.owner = owner

    def emit(self, record: logging.LogRecord) -> None:
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
        self.owner.submit(envelope)


class LogRuntime:
    def __init__(self, settings: LoggingSettings, output: TextIO) -> None:
        self.settings = settings
        self.output = output
        self.queue: queue.Queue[dict[str, Any]] = queue.Queue(settings.queue_capacity)
        self.dropped = 0
        self.output_errors = 0
        self.closed = False
        self.stop = threading.Event()
        self.handler = SafeHandler(self)
        self.worker = threading.Thread(target=self._write, name="wisp-log-output", daemon=True)
        self.worker.start()

    def submit(self, record: dict[str, Any]) -> None:
        if self.closed:
            return
        try:
            self.queue.put_nowait(record)
        except queue.Full:
            self.dropped += 1  # Drop newest at every level; never wait or recurse.

    def _write(self) -> None:
        reported_drops = 0
        reported_errors = 0
        while not self.stop.is_set() or not self.queue.empty():
            try:
                record = self.queue.get(timeout=0.02)
            except queue.Empty:
                continue
            try:
                drops, errors = self.dropped, self.output_errors
                if drops != reported_drops or errors != reported_errors:
                    record = {
                        **record,
                        "logging_health": {"dropped": drops, "output_errors": errors},
                    }
                self.output.write(format_record(record, self.settings.format) + "\n")
                self.output.flush()
                reported_drops, reported_errors = drops, errors
            except Exception:
                # Output extensions are an untrusted I/O boundary. Never log their errors.
                self.output_errors += 1
            finally:
                self.queue.task_done()

    def close(self) -> None:
        if self.closed:
            return
        self.closed = True
        self.stop.set()
        self.worker.join(self.settings.shutdown_timeout)
        if self.worker.is_alive():
            while True:
                try:
                    self.queue.get_nowait()
                    self.queue.task_done()
                    self.dropped += 1
                except queue.Empty:
                    break
        # Keep the safe closed handler installed: late library logs are discarded,
        # never sent through lastResort or a restored unsafe console handler.


def configure_logging(settings: LoggingSettings, output: TextIO | None = None) -> LogRuntime:
    global _active
    if _active is not None and not _active.closed:
        _active.close()
    if _active is not None and _active.closed and _active.worker.is_alive():
        return _active  # A stuck OS write cannot be killed; never accumulate more writer threads.
    runtime = LogRuntime(settings, output if output is not None else sys.stderr)
    root = logging.getLogger()
    root.handlers = [runtime.handler]
    root.setLevel(LEVELS[settings.level])
    for name, candidate in list(logging.Logger.manager.loggerDict.items()):
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
    _active = runtime
    return runtime
