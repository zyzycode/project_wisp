import asyncio
import hashlib
import json
import sqlite3
import time
from uuid import uuid4

import httpx
import pytest
from tests.helpers import CONTRACT_FIXTURES, touch_body
from wisp_backend.accounting.contracts import Usage
from wisp_backend.outcomes import Outcome

FIXTURE = CONTRACT_FIXTURES / "desktop-backend-v2/request.valid.json"


@pytest.fixture
def memory_body():
    return json.loads(FIXTURE.read_bytes())


@pytest.mark.parametrize("first_version", [1, 2])
def test_mixed_endpoint_same_id_conflicts_and_new_ids_are_admitted(
    app_factory, body, memory_body, completion, first_version
):
    async def run():
        calls = []

        def upstream(request):
            calls.append(request)
            return httpx.Response(
                200, json=completion(usage={"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2})
            )

        app = app_factory(upstream)
        memory_body["requestId"] = body["requestId"]
        requests = {1: body, 2: memory_body}
        second_version = 3 - first_version
        async with app.router.lifespan_context(app):
            ledger = app.state.completion_service.ledger
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                first = await client.post(f"/v{first_version}/chat", json=requests[first_version])
                assert first.status_code == 200
                conflict = await client.post(f"/v{second_version}/chat", json=requests[second_version])
                assert conflict.status_code == 409
                assert conflict.json()["error"]["code"] == "request_conflict"
                assert conflict.json()["version"] == second_version
                next_response = await client.post(
                    f"/v{second_version}/chat", json={**requests[second_version], "requestId": str(uuid4())}
                )
                assert next_response.status_code == 200
                replay = await client.post(f"/v{first_version}/chat", json=requests[first_version])
                assert replay.content == first.content
            with sqlite3.connect(ledger.path) as db:
                assert db.execute("SELECT requests,confirmed FROM days").fetchone() == (2, 4)
                stored = db.execute("SELECT digest FROM entries").fetchone()[0]
                assert stored.startswith(f"POST /v{first_version}/chat:")
        assert len(calls) == 2

    asyncio.run(run())


def test_legacy_body_digest_stays_v1_only_until_original_ttl(app_factory, body, memory_body, completion):
    async def run():
        calls = []

        def upstream(request):
            calls.append(request)
            return httpx.Response(200, json=completion())

        app = app_factory(upstream)
        raw = json.dumps(body).encode()
        old_digest = hashlib.sha256(raw).hexdigest()
        memory_body["requestId"] = body["requestId"]
        async with app.router.lifespan_context(app):
            ledger = app.state.completion_service.ledger
            clock = [time.time()]
            ledger.clock = lambda: clock[0]
            await ledger.admit(body["requestId"], old_digest)
            await ledger.settle(body["requestId"], Usage(1, 1, 2), Outcome(200, b'{"version":1,"text":"legacy cache"}'))
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                replay = await client.post("/v1/chat", content=raw, headers={"content-type": "application/json"})
                assert replay.status_code == 200 and replay.json()["text"] == "legacy cache"
                assert (await client.post("/v2/chat", json=memory_body)).status_code == 409
                clock[0] += 600
                assert (
                    await client.post("/v1/chat", content=raw, headers={"content-type": "application/json"})
                ).status_code == 409
                clock[0] += 86_400 - 600
                admitted = await client.post("/v2/chat", json=memory_body)
                assert admitted.status_code == 200 and admitted.json()["version"] == 2
        assert len(calls) == 1

    asyncio.run(run())


def test_simultaneous_versions_share_id_namespace_without_concurrency_quota(app_factory, body, memory_body, completion):
    async def run():
        entered, release = asyncio.Event(), asyncio.Event()
        calls = []

        async def upstream(request):
            calls.append(request)
            entered.set()
            await release.wait()
            return httpx.Response(200, json=completion())

        app = app_factory(upstream)
        memory_body["requestId"] = body["requestId"]
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                first = asyncio.create_task(client.post("/v1/chat", json=body))
                await entered.wait()
                conflict = await client.post("/v2/chat", json=memory_body)
                assert conflict.json()["error"]["code"] == "request_conflict"
                second = asyncio.create_task(client.post("/v2/chat", json={**memory_body, "requestId": str(uuid4())}))
                while len(calls) < 2:
                    await asyncio.sleep(0)
                release.set()
                assert (await first).status_code == (await second).status_code == 200
        assert len(calls) == 2

    asyncio.run(run())


@pytest.mark.parametrize("touch_first", [False, True])
def test_touch_and_v2_share_id_namespace(app_factory, body, memory_body, completion, touch_first):
    async def run():
        calls = []

        def upstream(request):
            calls.append(request)
            return httpx.Response(200, json=completion())

        app = app_factory(upstream)
        memory_body["requestId"] = body["requestId"]
        routes = [("/v1/touch", touch_body(body)), ("/v2/chat", memory_body)]
        if not touch_first:
            routes.reverse()
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                first_path, first_body = routes[0]
                second_path, second_body = routes[1]
                assert (await client.post(first_path, json=first_body)).status_code == 200
                conflict = await client.post(second_path, json=second_body)
                assert conflict.status_code == 409
                assert conflict.json()["version"] == second_body["version"]
                next_response = await client.post(second_path, json={**second_body, "requestId": str(uuid4())})
                assert next_response.status_code == 200
        assert len(calls) == 2

    asyncio.run(run())


def test_confirmed_usage_survives_invalid_v2_text_without_blocking_other_routes(
    app_factory, body, memory_body, completion
):
    from fastapi.testclient import TestClient

    app = app_factory(
        lambda _: httpx.Response(
            200, json=completion({"text": ""}, usage={"prompt_tokens": 3, "completion_tokens": 4, "total_tokens": 7})
        )
    )
    with TestClient(app) as client:
        first = client.post("/v2/chat", json=memory_body)
        assert first.status_code == 502
        repeat = client.post("/v2/chat", json=memory_body)
        assert repeat.content == first.content
        next_response = client.post("/v1/chat", json=body)
        assert next_response.status_code == 502
        with sqlite3.connect(app.state.completion_service.ledger.path) as db:
            assert db.execute("SELECT requests,confirmed,uncertain FROM days").fetchone() == (2, 14, 0)
