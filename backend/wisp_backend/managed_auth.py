"""Authenticate every managed HTTP request before the normal API boundary."""

from hmac import compare_digest

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send


class ManagedTokenGuard:
    def __init__(self, app: ASGIApp, token: str) -> None:
        self.app = app
        self._authorization = b"Bearer " + token.encode("ascii")

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "websocket":
            await send({"type": "websocket.close", "code": 1008})
            return
        if scope["type"] == "http":
            headers = scope.get("headers", [])
            values = [value for name, value in headers if name.lower() == b"authorization"]
            origin = any(name.lower() == b"origin" for name, _ in headers)
            authorized = len(values) == 1 and compare_digest(values[0], self._authorization)
            if origin or not authorized:
                await JSONResponse({"error": "unauthorized"}, status_code=401)(scope, receive, send)
                return
        await self.app(scope, receive, send)
