"""In-memory adapters for execution and resource-ownership tests."""

from dataclasses import dataclass, field
from threading import Event

from wisp_backend.accounting.contracts import Admission, Usage
from wisp_backend.completion.contracts import InferenceRequest, ProviderResult
from wisp_backend.outcomes import Outcome


@dataclass
class MemoryLedger:
    replay: Outcome | None = None
    admissions: int = 0
    settlements: list[tuple[Usage | None, Outcome | None]] = field(default_factory=list)

    async def admit(self, request_id: str, digest: str, legacy_digest: str | None = None) -> Admission:
        self.admissions += 1
        return Admission(self.replay)

    async def settle(self, request_id: str, usage: Usage | None, outcome: Outcome | None,
                     deadline: float | None = None, cancelled: Event | None = None) -> None:
        self.settlements.append((usage, outcome))

    async def maintain(self) -> None:
        pass

    async def close(self) -> None:
        pass


@dataclass
class StubProvider:
    result: ProviderResult
    calls: int = 0

    async def complete(self, request: InferenceRequest, timeout: float) -> ProviderResult:
        self.calls += 1
        return self.result
