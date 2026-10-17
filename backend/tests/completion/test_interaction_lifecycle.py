"""V7 uses the existing ledger, deadlines, cancellation and volatile response cache."""
import asyncio
from collections.abc import Callable
from dataclasses import replace
import json
import sqlite3
from uuid import uuid4

from fastapi import FastAPI
import httpx
import pytest

from tests.api.test_interaction_validation import fixture, REQUESTS
from tests.helpers import Clock, gemini_completion
from wisp_backend.accounting.contracts import Usage
from wisp_backend.accounting.policy import ID_TTL
from wisp_backend.accounting.replay import CACHE_TTL
from wisp_backend.api.dispatch import prepare_job
from wisp_backend.completion.contracts import InferenceRequest, ProviderResult
from wisp_backend.completion.policies import POLICIES, Scenario


@pytest.mark.parametrize('provider', ['groq', 'gemini'])
@pytest.mark.parametrize('operation', ['touch', 'chat'])
def test_pending_replay_conflict_and_retention(app_factory: Callable[..., FastAPI], completion: Callable[..., dict],
                                              provider: str, operation: str, caplog: pytest.LogCaptureFixture) -> None:
    async def run() -> None:
        clock = Clock()
        entered, release = asyncio.Event(), asyncio.Event()
        calls = 0
        response = fixture(f'response.{operation}.json')
        reply = {k: v for k, v in response.items() if k not in ('version', 'requestId')}
        reply['text'] = 'PRIVATE_REPLY'
        async def upstream(request: httpx.Request) -> httpx.Response:
            nonlocal calls
            calls += 1; entered.set(); await release.wait()
            return httpx.Response(200, json=completion(reply) if provider == 'groq' else gemini_completion(reply))
        app = app_factory(upstream, assistants={'default': {'provider': provider}})
        body = fixture(f'request.{operation}.json'); route = f'/v7/{operation}'
        body['character']['personality']['aiSelfConcept'] = 'PRIVATE_CHARACTER'
        if operation == 'chat': body['previousTouch']['publishedText'] = 'PRIVATE_TOUCH'
        body2 = {**body, 'requestId': str(uuid4())}
        async with app.router.lifespan_context(app):
            ledger = app.state.completion_service.ledger; ledger.clock = clock
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
                first = asyncio.create_task(client.post(route, json=body))
                try:
                    await asyncio.wait_for(entered.wait(), 2)
                    pending = await client.post(route, json=body)
                    assert pending.status_code == 409 and pending.json()['error']['code'] == 'request_in_progress'
                    changed = await client.post(route, json={**body, 'locale': 'en'})
                    assert changed.status_code == 409 and changed.json()['error']['code'] == 'request_conflict'
                finally:
                    release.set()
                    result = await first
                assert result.status_code == 200
                other = 'chat' if operation == 'touch' else 'touch'
                assert (await client.post(f'/v7/{other}', json=fixture(f'request.{other}.json'))).status_code == 409
                old = {k: v for k, v in body.items() if k not in ('card', 'effectPolicy', 'previousTouch')}
                old['version'] = 1 if operation == 'touch' else 5
                assert (await client.post(f'/v{old["version"]}/{operation}', json=old)).status_code == 409
                clock.now += CACHE_TTL - .001
                assert (await client.post(route, json=body)).content == result.content
                clock.now += .001
                assert (await client.post(route, json=body)).status_code == 409
                assert (await client.post(route, json=body2)).status_code == 200
            with sqlite3.connect(ledger.path) as db:
                dump = '\n'.join(db.iterdump())
                assert 'PRIVATE_' not in dump
                assert db.execute('SELECT requests,reserved FROM days').fetchone() == (2, 0)
        restarted = app_factory(upstream, ledger_path=ledger.path, assistants={'default': {'provider': provider}})
        async with restarted.router.lifespan_context(restarted):
            reopened = restarted.state.completion_service.ledger; reopened.clock = clock
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=restarted), base_url='http://test') as client:
                assert (await client.post(route, json=body2)).status_code == 409
            clock.now += ID_TTL
            await reopened.maintain()
            with sqlite3.connect(reopened.path) as db:
                assert db.execute('SELECT count(*) FROM entries').fetchone() == (0,)
        assert calls == 2
    asyncio.run(run())
    assert 'PRIVATE_' not in caplog.text


@pytest.mark.parametrize('provider', ['groq', 'gemini'])
@pytest.mark.parametrize('operation', ['touch', 'chat'])
@pytest.mark.parametrize('shutdown', [False, True])
def test_disconnect_or_shutdown_closes_http_and_settles(app_factory: Callable[..., FastAPI], provider: str,
                                                       operation: str, shutdown: bool) -> None:
    async def run() -> None:
        entered, cancelled = asyncio.Event(), asyncio.Event()
        async def upstream(request: httpx.Request) -> httpx.Response:
            entered.set()
            try: await asyncio.Future()
            finally: cancelled.set()
        app = app_factory(upstream, assistants={'default': {'provider': provider}})
        sent = []
        async with app.router.lifespan_context(app):
            service = app.state.completion_service
            delivered = False
            async def receive() -> dict:
                nonlocal delivered
                if not delivered:
                    delivered = True
                    return {'type': 'http.request', 'body': json.dumps(fixture(f'request.{operation}.json')).encode(), 'more_body': False}
                await entered.wait()
                if shutdown: await asyncio.Future()
                return {'type': 'http.disconnect'}
            async def send(value: dict) -> None: sent.append(value)
            scope = {'type': 'http', 'asgi': {'version': '3.0'}, 'path': f'/v7/{operation}', 'method': 'POST',
                     'headers': [(b'content-type', b'application/json')], 'query_string': b'', 'scheme': 'http',
                     'server': ('test', 80), 'client': ('127.0.0.1', 123), 'http_version': '1.1'}
            task = asyncio.create_task(app(scope, receive, send))
            await asyncio.wait_for(entered.wait(), 2)
            if shutdown: await service.close()
            await asyncio.wait_for(task, 2); await asyncio.wait_for(cancelled.wait(), 2)
            assert not sent
            with sqlite3.connect(service.ledger.path) as db:
                assert db.execute('SELECT requests,reserved FROM days').fetchone() == (1, 0)
                assert db.execute("SELECT count(*) FROM entries WHERE state='flight'").fetchone() == (0,)
    asyncio.run(run())


@pytest.mark.parametrize('operation,scenario', [('touch', Scenario.INTERACTION_TOUCH), ('chat', Scenario.INTERACTION_CHAT)])
def test_late_usage_settles_once_without_publishing(app_factory: Callable[..., FastAPI], monkeypatch: pytest.MonkeyPatch,
                                                  operation: str, scenario: Scenario) -> None:
    monkeypatch.setitem(POLICIES, scenario, replace(POLICIES[scenario], timeout=.1))
    async def run() -> None:
        release = asyncio.Event()
        calls = 0
        class LateProvider:
            async def complete(self, request: InferenceRequest, timeout: float) -> ProviderResult:
                nonlocal calls
                calls += 1
                try: await asyncio.Future()
                except asyncio.CancelledError:
                    await release.wait()
                    return ProviderResult(json.dumps({'text': 'PRIVATE_LATE', 'appraisal': {
                        'category': 'neutral', 'intensity': 'low', 'confidence': 'clear'}}), Usage(2, 3, 5))
        app = app_factory(lambda _: pytest.fail('unexpected HTTP'))
        async with app.router.lifespan_context(app):
            service = app.state.completion_service; service.provider = LateProvider()
            body = REQUESTS[f'/v7/{operation}'].model_validate(fixture(f'request.{operation}.json'))
            first = await service.complete(prepare_job(body), 'digest', asyncio.get_running_loop().time())
            assert first.status == 504 and json.loads(first.body)['version'] == 7
            release.set()
            async def drain() -> None:
                while service.background: await asyncio.sleep(0)
            await asyncio.wait_for(drain(), 2)
            for _ in range(2):
                assert (await service.complete(prepare_job(body), 'digest', asyncio.get_running_loop().time())).status == 409
            with sqlite3.connect(service.ledger.path) as db:
                assert db.execute('SELECT requests,reserved,confirmed,uncertain FROM days').fetchone() == (1, 0, 5, 0)
            assert calls == 1
    asyncio.run(run())


@pytest.mark.parametrize('operation,scenario', [('touch', Scenario.INTERACTION_TOUCH), ('chat', Scenario.INTERACTION_CHAT)])
@pytest.mark.parametrize('provider', ['groq', 'gemini'])
def test_deadline_closes_response_stream(app_factory: Callable[..., FastAPI], monkeypatch: pytest.MonkeyPatch,
                                        operation: str, scenario: Scenario, provider: str) -> None:
    monkeypatch.setitem(POLICIES, scenario, replace(POLICIES[scenario], timeout=.1))
    async def run() -> None:
        closed = asyncio.Event()
        class Stream(httpx.AsyncByteStream):
            async def __aiter__(self):
                yield b'{'
                await asyncio.Future()
            async def aclose(self) -> None: closed.set()
        app = app_factory(lambda _: httpx.Response(200, stream=Stream()), assistants={'default': {'provider': provider}})
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
                response = await client.post(f'/v7/{operation}', json=fixture(f'request.{operation}.json'))
                assert response.status_code == 504
                await asyncio.wait_for(closed.wait(), 2)
    asyncio.run(run())
