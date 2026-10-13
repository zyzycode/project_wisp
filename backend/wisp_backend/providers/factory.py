"""Composition registry, separate from configuration and the service port."""
import httpx

from wisp_backend.providers.base import Provider
from wisp_backend.providers.gemini import GeminiProvider
from wisp_backend.providers.groq import GroqProvider

FACTORIES = {"groq": GroqProvider, "gemini": GeminiProvider}


def create_provider(provider: str, client: httpx.AsyncClient) -> Provider:
    return FACTORIES[provider](client)
