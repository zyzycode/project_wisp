"""Application factory: compose one runtime with the versioned HTTP API."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
import httpx

from wisp_backend.api.setup import install_api
from wisp_backend.completion.prompts.lore import load_catalogue
from wisp_backend.config.loader import load_settings
from wisp_backend.config.settings import Settings
from wisp_backend.runtime import open_runtime


def create_app(transport: httpx.AsyncBaseTransport | None = None, *, settings: Settings | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.lore_catalogue = load_catalogue()
        config = settings if settings is not None else load_settings()
        async with open_runtime(config, transport) as service:
            app.state.completion_service = service
            yield

    app = FastAPI(title="Wisp API", version="1.0.0", lifespan=lifespan)
    install_api(app)
    return app
