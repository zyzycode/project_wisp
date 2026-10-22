"""A normal pause between turns should not force another upstream connection."""

import asyncio
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from types import SimpleNamespace

import httpcore._async.http11
from pydantic import SecretStr
from wisp_backend.config.settings import Settings
from wisp_backend.providers.client import create_client


def test_reuses_connection_between_turns_and_expires_idle_connection(monkeypatch):
    peers = []
    elapsed = 0
    real_clock = time.monotonic
    monkeypatch.setattr(httpcore._async.http11, "time", SimpleNamespace(monotonic=lambda: real_clock() + elapsed))

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def do_GET(self):
            peers.append(self.client_address)
            self.send_response(200)
            self.send_header("Content-Length", "2")
            self.end_headers()
            self.wfile.write(b"{}")

        def log_message(self, message_format, *args):
            pass

    with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()

        async def run():
            nonlocal elapsed
            settings = Settings(api_key=SecretStr("test-key"), base_url=f"http://127.0.0.1:{server.server_port}/")
            async with create_client(settings) as client:
                assert (await client.get("probe")).status_code == 200
                elapsed = 6
                assert (await client.get("probe")).status_code == 200
                assert peers[0] == peers[1]
                elapsed = 67
                assert (await client.get("probe")).status_code == 200
                assert peers[2] != peers[1]
            assert client.is_closed

        try:
            asyncio.run(run())
        finally:
            server.shutdown()
            thread.join(timeout=5)
