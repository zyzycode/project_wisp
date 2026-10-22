"""Construction of the shared upstream HTTP client."""

import httpx
from wisp_backend.config.settings import Settings


def create_client(
    settings: Settings,
    transport: httpx.AsyncBaseTransport | None = None,
) -> httpx.AsyncClient:
    key = settings.api_key.get_secret_value()
    headers = {"x-goog-api-key": key} if settings.provider == "gemini" else {"Authorization": f"Bearer {key}"}
    return httpx.AsyncClient(
        base_url=settings.base_url,
        headers=headers,
        timeout=httpx.Timeout(
            settings.request_timeout,
            connect=settings.connect_timeout,
            pool=settings.pool_timeout,
        ),
        transport=transport,
        follow_redirects=False,
        trust_env=settings.upstream_trust_env,
    )
