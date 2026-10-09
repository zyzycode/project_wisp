"""Construction of the shared upstream HTTP client."""

import httpx

from wisp_backend.config import Settings


def create_client(
    settings: Settings, transport: httpx.AsyncBaseTransport | None = None,
) -> httpx.AsyncClient:
    if settings.provider == "groq" and settings.api_key is None:
        raise ValueError("Groq requires an API key")
    return httpx.AsyncClient(
        base_url=settings.base_url,
        headers=({"Authorization": f"Bearer {settings.api_key.get_secret_value()}"}
                 if settings.provider == "groq" and settings.api_key else {}),
        timeout=httpx.Timeout(
            settings.request_timeout,
            connect=settings.connect_timeout,
            pool=settings.pool_timeout,
        ),
        transport=transport,
        follow_redirects=False,
        trust_env=settings.upstream_trust_env,
    )
