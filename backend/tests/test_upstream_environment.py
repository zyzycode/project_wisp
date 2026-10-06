"""Exercise real HTTP routing with inherited, unreachable proxy settings."""
import json
import socket
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread

from fastapi.testclient import TestClient
from pydantic import SecretStr
import pytest

from wisp_backend.application import create_app
from wisp_backend.config import Settings


@pytest.mark.parametrize("trust_env,status", [(False, 200), (True, 503)])
def test_inherited_proxy_is_explicit(monkeypatch, body, trust_env, status):
    class ProviderHandler(BaseHTTPRequestHandler):
        def do_POST(self):
            self.rfile.read(int(self.headers["Content-Length"]))
            response = json.dumps({"choices": [{
                "finish_reason": "stop", "message": {"content": '{"text":"42"}'},
            }]}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(response)))
            self.end_headers()
            self.wfile.write(response)

        def log_message(self, format, *args):
            pass

    # Reserve an unused port without listening: a connection to the proxy fails.
    with socket.socket() as unavailable_proxy:
        unavailable_proxy.bind(("127.0.0.1", 0))
        proxy_url = f"http://127.0.0.1:{unavailable_proxy.getsockname()[1]}"
        for name in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
            monkeypatch.setenv(name, proxy_url)
        for name in ("NO_PROXY", "no_proxy"):
            monkeypatch.delenv(name, raising=False)
        with ThreadingHTTPServer(("127.0.0.1", 0), ProviderHandler) as server:
            thread = Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                settings = Settings(api_key=SecretStr("test-key"),
                                    upstream_trust_env=trust_env,
                                    base_url=f"http://127.0.0.1:{server.server_port}/openai/v1/")
                with TestClient(create_app(settings=settings)) as client:
                    response = client.post("/v1/chat", json=body)
                    assert response.status_code == status
                    if status == 200:
                        assert response.json()["text"] == "42"
                    else:
                        assert response.json()["error"]["code"] == "upstream_unavailable"
            finally:
                server.shutdown()
                thread.join(timeout=5)
