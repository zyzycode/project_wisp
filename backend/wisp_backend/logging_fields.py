"""Closed, shallow metadata schema. No free-form payload serialization."""

import math
import re
from collections.abc import Mapping
from typing import Any

TOKEN = re.compile(r"[a-z][a-z0-9_.]{0,79}\Z")
NUMBERS = {"duration_ms", "count", "status_code", "queue_depth", "dropped", "output_errors"}
LABELS = {
    "operation": {"maintenance", "http", "completion", "provider", "settlement", "cancel"},
    "outcome": {"success", "failure", "cancelled", "expected", "unexpected", "no_response"},
    "method": {"GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS", "OTHER"},
    "route": {"/health", "/v1/chat", "/v1/touch", "/v1/events", "/v1/observation", "/v1/summary", "other"},
    "category": {
        "invalid_request",
        "payload_too_large",
        "request_conflict",
        "request_in_progress",
        "rate_limited",
        "budget_exhausted",
        "upstream_unavailable",
        "upstream_timeout",
        "invalid_model_response",
        "unexpected",
    },
}


def safe_fields(values: object) -> dict[str, Any]:
    if not isinstance(values, Mapping):
        return {}
    result: dict[str, Any] = {}
    for key in NUMBERS:
        value = values.get(key)
        if type(value) in (int, float) and 0 <= value <= 1e12 and math.isfinite(value):
            result[key] = round(value, 3)
    for key, allowed in LABELS.items():
        value = values.get(key)
        if type(value) is str and value in allowed:
            result[key] = value
    return result


def safe_error(error: BaseException) -> dict[str, Any]:
    """Only builtin exception classes and in-repository frame locations; no values."""
    chain: list[dict[str, Any]] = []
    seen: set[int] = set()
    while error is not None and id(error) not in seen and len(chain) < 4:
        seen.add(id(error))
        name = type(error).__name__ if type(error).__module__ == "builtins" else "ApplicationError"
        entry: dict[str, Any] = {"type": name}
        trace = error.__traceback__
        while trace is not None:
            filename = trace.tb_frame.f_code.co_filename.replace("\\", "/")
            if "/wisp_backend/" in filename:
                entry["location"] = filename.split("/wisp_backend/", 1)[1] + ":" + str(trace.tb_lineno)
            trace = trace.tb_next
        chain.append(entry)
        error = error.__cause__ or (None if error.__suppress_context__ else error.__context__)
    return {"chain": chain}
