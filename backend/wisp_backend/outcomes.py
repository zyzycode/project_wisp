"""Opaque delivery snapshots shared by execution and idempotent replay."""

from dataclasses import dataclass


@dataclass(frozen=True)
class Outcome:
    status: int
    body: bytes


MAX_RESPONSE_BYTES = 16 * 1024
