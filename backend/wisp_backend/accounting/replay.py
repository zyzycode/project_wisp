"""Bounded volatile reply snapshots, published only after durable settlement."""

from collections import OrderedDict
from threading import Event
import time

from wisp_backend.outcomes import Outcome


CACHE_TTL = 600
CACHE_CAPACITY = 100


class ReplayCache:
    """All calls are serialized by the owning ledger's lock."""
    def __init__(self) -> None:
        self._entries: OrderedDict[str, tuple[float, Outcome, Event | None]] = OrderedDict()

    def __contains__(self, request_id: str) -> bool:
        return request_id in self._entries

    def get(self, request_id: str) -> Outcome | None:
        entry = self._entries.get(request_id)
        if entry is None:
            return None
        _, outcome, cancelled = entry
        if cancelled is not None and cancelled.is_set():
            del self._entries[request_id]
            return None
        return outcome

    def publish(self, request_id: str, outcome: Outcome, now: float,
                deadline: float | None, cancelled: Event | None) -> None:
        if deadline is not None and time.monotonic() >= deadline:
            return
        if cancelled is not None and cancelled.is_set():
            return
        self._entries[request_id] = (now, outcome, cancelled)
        while len(self._entries) > CACHE_CAPACITY:
            self._entries.popitem(last=False)

    def expire(self, now: float) -> None:
        for request_id, (created, _, _) in list(self._entries.items()):
            if created + CACHE_TTL <= now:
                del self._entries[request_id]

    def clear(self) -> None:
        self._entries.clear()
