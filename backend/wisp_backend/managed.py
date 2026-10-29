"""Private desktop entry: python -m wisp_backend.managed (one stdin bootstrap)."""

import asyncio
import json
import os
import socket
import sys
from threading import Event, Thread
from typing import BinaryIO, TextIO

import httpx
import uvicorn
from starlette.types import ASGIApp
from wisp_backend.application import create_app
from wisp_backend.logging.config import LoggingSettings
from wisp_backend.logging.output import configure_logging
from wisp_backend.managed_auth import ManagedTokenGuard
from wisp_backend.managed_bootstrap import BootstrapError, ManagedBootstrap, read_bootstrap


def create_managed_app(bootstrap: ManagedBootstrap, transport: httpx.AsyncBaseTransport | None = None) -> ASGIApp:
    app = create_app(transport, settings=bootstrap.settings(), expose_docs=False)
    return ManagedTokenGuard(app, bootstrap.sessionToken.get_secret_value())


class ReadyServer(uvicorn.Server):
    def __init__(self, config: uvicorn.Config, port: int, output: TextIO) -> None:
        super().__init__(config)
        self.port = port
        self.output = output

    async def startup(self, sockets: list[socket.socket] | None = None) -> None:
        await super().startup(sockets=sockets)
        if self.started and not self.should_exit:
            self.output.write(json.dumps({"kind": "ready", "port": self.port}, separators=(",", ":")) + "\n")
            self.output.flush()


def watch_parent(stream: BinaryIO, loop: asyncio.AbstractEventLoop, server: ReadyServer, stopped: Event) -> None:
    """EOF or a forbidden second bootstrap requests shutdown; enforce a total bound."""
    try:
        stream.read(1)
    except OSError:
        pass
    if stopped.is_set():
        return
    try:
        loop.call_soon_threadsafe(setattr, server, "should_exit", True)
    except RuntimeError:
        return
    # The daemon watchdog also bounds a stalled lifespan startup/shutdown.
    # Normal shutdown closes runtime resources; hard exit is the last resort.
    if not stopped.wait(2.5):
        os._exit(1)


async def run_managed(bootstrap: ManagedBootstrap, source: BinaryIO, output: TextIO) -> None:
    configure_logging(LoggingSettings())
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        listener.setblocking(False)
        port = listener.getsockname()[1]
        config = uvicorn.Config(
            create_managed_app(bootstrap),
            host="127.0.0.1",
            port=port,
            workers=1,
            lifespan="on",
            log_config=None,
            access_log=False,
            timeout_graceful_shutdown=1,
        )
        server = ReadyServer(config, port, output)
        stopped = Event()
        Thread(target=watch_parent, args=(source, asyncio.get_running_loop(), server, stopped), daemon=True).start()
        try:
            await server.serve(sockets=[listener])
        finally:
            stopped.set()


def main() -> int:
    try:
        # An unbuffered pipe prevents a waiting daemon from retaining the stdin
        # buffer lock during interpreter shutdown after an early startup error.
        source = sys.stdin.buffer.raw
        bootstrap = read_bootstrap(source)
        asyncio.run(run_managed(bootstrap, source, sys.stdout))
        return 0
    except BootstrapError:
        sys.stderr.write("Invalid managed bootstrap\n")
        return 1
    except (Exception, SystemExit):
        # This process boundary deliberately omits exception messages/tracebacks.
        sys.stderr.write("Managed backend failed\n")
        return 1
    except KeyboardInterrupt:
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
