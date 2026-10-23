"""Observe HTTP lifetime without headers, body, address, query or raw path."""

import asyncio
import time

from starlette.types import ASGIApp, Message, Receive, Scope, Send
from wisp_backend.logging import get_logger, log_context
from wisp_backend.logging.fields import LABELS

logger = get_logger(__name__)


class RequestLogging:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        route = scope.get("path", "")
        method = scope.get("method", "")
        status: int | None = None
        disconnected = False
        response_completed = False
        started = time.monotonic()

        async def observed_receive() -> Message:
            nonlocal disconnected
            message = await receive()
            if message["type"] == "http.disconnect" and not response_completed:
                disconnected = True
            return message

        async def observed_send(message: Message) -> None:
            nonlocal status, response_completed
            if message["type"] == "http.response.start":
                status = message["status"]
            await send(message)
            if message["type"] == "http.response.body" and not message.get("more_body", False):
                response_completed = True

        with log_context(
            operation="http",
            route=route if route in LABELS["route"] else "other",
            method=method if method in LABELS["method"] else "OTHER",
        ):
            logger.debug("http_started")
            outcome = "success"
            try:
                await self.app(scope, observed_receive, observed_send)
            except asyncio.CancelledError:
                outcome = "cancelled"
                raise
            except Exception as error:
                outcome = "unexpected"
                logger.error("http_failed", error=error, fields={"category": "unexpected"})
                raise
            finally:
                if outcome == "success":
                    if disconnected:
                        outcome = "cancelled"
                    elif status is None:
                        outcome = "no_response"
                    elif status >= 400:
                        outcome = "failure"
                logger.info(
                    "http_finished",
                    fields={
                        "status_code": status,
                        "duration_ms": (time.monotonic() - started) * 1000,
                        "outcome": outcome,
                    },
                )
