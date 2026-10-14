"""Inference adapter port. Model configuration is bound at composition time."""

from typing import Protocol

from wisp_backend.completion.contracts import InferenceRequest, ProviderResult


class Provider(Protocol):
    async def complete(self, request: InferenceRequest, timeout: float) -> ProviderResult: ...
