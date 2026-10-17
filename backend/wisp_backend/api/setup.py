"""Install the HTTP boundary, routers, error envelopes and OpenAPI policy."""

from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from starlette.responses import Response

from wisp_backend.api.boundary import CompletionBoundary
from wisp_backend.api.endpoints import ENDPOINTS
from wisp_backend.api.responses import error_response
from wisp_backend.api.routes import chat, events, health, interaction, memory, observation, source, summary, touch
from wisp_backend.errors import ServiceError


def install_api(app: FastAPI) -> None:
    app.add_middleware(CompletionBoundary)
    app.add_middleware(source.SourceOffer)
    app.description = "[Исходный код / AGPL — бесплатный полный Corresponding Source](./source)"

    @app.exception_handler(ServiceError)
    async def service_error(request: Request, error: ServiceError) -> Response:
        return error_response(error.code, getattr(request.state, "request_id", None), error.retry_after_ms,
                              getattr(request.state, "wire_version", 1))

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, error: RequestValidationError) -> Response:
        return error_response("invalid_request", getattr(request.state, "request_id", None),
                              version=getattr(request.state, "wire_version", 1))

    for router in (health.router, chat.router, touch.router, memory.router, events.router, source.router, summary.router, observation.router, interaction.router):
        app.include_router(router)

    default_openapi = app.openapi

    def openapi() -> dict[str, Any]:
        spec = default_openapi()
        for path in ENDPOINTS:
            spec["paths"][path]["post"]["responses"].pop("422", None)
        return spec

    app.openapi = openapi
