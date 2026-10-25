"""Exercise real HTTP routing with an inherited proxy that rejects requests."""

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from wisp_backend.application import create_app
from wisp_backend.config.settings import Settings


@pytest.mark.parametrize("trust_env,status", [(False, 200), (True, 503)])
def test_inherited_proxy_is_explicit(monkeypatch, body, trust_env, status, tmp_path):
    calls = {"provider": 0, "proxy": 0}

    class ProviderHandler(BaseHTTPRequestHandler):
        def do_POST(self):
            calls["provider"] += 1
            self.rfile.read(int(self.headers["Content-Length"]))
            response = json.dumps(
                {
                    "choices": [
                        {
                            "finish_reason": "stop",
                            "message": {
                                "content": '{"text":"42","appraisal":{"category":"neutral","intensity":"low","confidence":"clear"}}'
                            },
                        }
                    ]
                }
            ).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(response)))
            self.end_headers()
            self.wfile.write(response)

        def log_message(self, message_format: str, *args: object) -> None:
            pass

    class ProxyHandler(BaseHTTPRequestHandler):
        def do_POST(self):
            calls["proxy"] += 1
            self.rfile.read(int(self.headers["Content-Length"]))
            self.send_response(502)
            self.send_header("Content-Length", "0")
            self.end_headers()

        def log_message(self, message_format: str, *args: object) -> None:
            pass

    # A real error response is deterministic across platforms; a bound but
    # non-listening socket may time out instead of refusing the connection.
    with (
        ThreadingHTTPServer(("127.0.0.1", 0), ProxyHandler) as proxy,
        ThreadingHTTPServer(("127.0.0.1", 0), ProviderHandler) as server,
    ):
        proxy_url = f"http://127.0.0.1:{proxy.server_port}"
        for name in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
            monkeypatch.setenv(name, proxy_url)
        for name in ("NO_PROXY", "no_proxy"):
            monkeypatch.delenv(name, raising=False)
        threads = [Thread(target=endpoint.serve_forever, daemon=True) for endpoint in (proxy, server)]
        for thread in threads:
            thread.start()
        try:
            settings = Settings(
                api_key=SecretStr("test-key"),
                ledger_path=tmp_path / "ledger.sqlite",
                upstream_trust_env=trust_env,
                base_url=f"http://127.0.0.1:{server.server_port}/openai/v1/",
            )
            with TestClient(create_app(settings=settings)) as client:
                response = client.post("/v1/chat", json=body)
                assert response.status_code == status
                assert calls == {"provider": int(not trust_env), "proxy": int(trust_env)}
                if status == 200:
                    assert response.json()["text"] == "42"
                else:
                    assert response.json()["error"]["code"] == "upstream_unavailable"
        finally:
            proxy.shutdown()
            server.shutdown()
            for thread in threads:
                thread.join(timeout=5)
