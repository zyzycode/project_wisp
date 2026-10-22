"""The server consumes the same v1 wire fixtures as desktop tests."""

import json

import httpx
from tests.helpers import CONTRACT_FIXTURES

FIXTURES = CONTRACT_FIXTURES / "desktop-backend-v1"


def fixture(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def test_shared_success(client_factory, completion):
    request = fixture("request.valid.json")
    expected = fixture("response.success.json")
    reply = {key: value for key, value in expected.items() if key not in {"version", "requestId"}}
    with client_factory(lambda _: httpx.Response(200, json=completion(reply))) as client:
        response = client.post("/v1/chat", json=request)
        assert response.status_code == 200
        assert response.json() == expected


def test_shared_unavailable(client_factory):
    with client_factory(lambda _: httpx.Response(503)) as client:
        response = client.post("/v1/chat", json=fixture("request.valid.json"))
        assert response.status_code == 503
        assert response.json() == fixture("response.error.json")
