"""Composition registry, separate from configuration and the service port."""

import httpx

from wisp_backend.completion.ports import Provider
from wisp_backend.config.settings import AssistantSettings
from wisp_backend.providers.gemini import GeminiProvider
from wisp_backend.providers.groq import GroqProvider


FACTORIES = {"groq": GroqProvider, "gemini": GeminiProvider}


def create_provider(settings: AssistantSettings, client: httpx.AsyncClient) -> Provider:
    return FACTORIES[settings.provider](client, settings)
