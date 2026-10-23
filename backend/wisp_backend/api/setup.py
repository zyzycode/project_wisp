"""Install the HTTP boundary, routers, error envelopes and OpenAPI policy."""

from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from starlette.responses import Response
from wisp_backend.api.boundary import CompletionBoundary
from wisp_backend.api.endpoints import ENDPOINTS
from wisp_backend.api.logging import RequestLogging
from wisp_backend.api.responses import error_response
from wisp_backend.api.routes import events, health, interaction, observation, summary
from wisp_backend.errors import ServiceError
from wisp_backend.logging import get_logger


def install_api(app: FastAPI) -> None:
    app.add_middleware(CompletionBoundary)
    app.add_middleware(RequestLogging)

    @app.exception_handler(ServiceError)
    async def service_error(request: Request, error: ServiceError) -> Response:
        get_logger(__name__).warning("request_rejected", fields={"category": error.code, "outcome": "expected"})
        return error_response(
            error.code,
            getattr(request.state, "request_id", None),
            error.retry_after_ms,
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, error: RequestValidationError) -> Response:
        return error_response(
            "invalid_request",
            getattr(request.state, "request_id", None),
        )

    for router in (
        health.router,
        events.router,
        summary.router,
        observation.router,
        interaction.router,
    ):
        app.include_router(router)

    default_openapi = app.openapi

    def openapi() -> dict[str, Any]:
        spec = default_openapi()
        for path in ENDPOINTS:
            spec["paths"][path]["post"]["responses"].pop("422", None)
        return spec

    app.openapi = openapi
