"""Accounting values and storage port, independent of AI and HTTP schemas."""

from dataclasses import dataclass
from threading import Event
from typing import Protocol

from wisp_backend.outcomes import Outcome


RESERVATION = 131_072  # Legacy on-disk reservation, also the Groq default.


@dataclass(frozen=True)
class Usage:
    prompt: int
    completion: int
    total: int

    @classmethod
    def validated(cls, prompt: object, completion: object, total: object) -> "Usage | None":
        if type(prompt) is not int or type(completion) is not int or type(total) is not int:
            return None
        if min(prompt, completion, total) < 0:
            return None
        if prompt + completion != total:
            return None
        return cls(prompt, completion, total)


@dataclass(frozen=True)
class Admission:
    replay: Outcome | None = None


class Ledger(Protocol):
    async def admit(self, request_id: str, digest: str, legacy_digest: str | None = None) -> Admission: ...
    async def settle(self, request_id: str, usage: Usage | None, outcome: Outcome | None,
                     deadline: float | None = None, cancelled: Event | None = None) -> None: ...
    async def maintain(self) -> None: ...
    async def close(self) -> None: ...
