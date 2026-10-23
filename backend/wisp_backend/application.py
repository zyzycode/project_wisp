"""Application factory: compose one runtime with the versioned HTTP API."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from wisp_backend.api.setup import install_api
from wisp_backend.completion.prompts.lore import load_catalogue
from wisp_backend.completion.prompts.resources import get_prompt_resources
from wisp_backend.config.loader import load_logging_settings, load_settings
from wisp_backend.config.settings import Settings
from wisp_backend.logging import get_logger
from wisp_backend.logging.config import LoggingSettings
from wisp_backend.logging.output import configure_logging
from wisp_backend.runtime import open_runtime


def create_app(transport: httpx.AsyncBaseTransport | None = None, *, settings: Settings | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        configured = False
        logger = get_logger(__name__)
        try:
            configure_logging(settings.logging if settings is not None else load_logging_settings())
            configured = True
            get_prompt_resources()
            config = settings if settings is not None else load_settings()
            logger.info("application_starting")
            app.state.lore_catalogue = load_catalogue()
            async with open_runtime(config, transport) as service:
                app.state.completion_service = service
                logger.info("application_started")
                yield
        except Exception as error:
            if not configured:
                configure_logging(LoggingSettings())
            logger.error("application_failed", error=error, fields={"category": "unexpected"})
            raise
        finally:
            logger.info("application_stopped")

    app = FastAPI(title="Wisp API", version="1.0.0", lifespan=lifespan)
    install_api(app)
    return app
