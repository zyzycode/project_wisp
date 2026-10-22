import asyncio
import hashlib
import json
import sqlite3

import httpx
import pytest
from tests.helpers import touch_body
from wisp_backend.accounting.contracts import RESERVATION, Usage
from wisp_backend.api.boundary import CompletionBoundary
from wisp_backend.api.dispatch import prepare_job
from wisp_backend.api.schemas.interaction import InteractionChatRequest as ChatRequest
from wisp_backend.api.schemas.interaction import InteractionTouchRequest as TouchRequest
from wisp_backend.completion.contracts import ProviderResult
from wisp_backend.config.profiles import PROFILES


def test_slow_body_never_admitted(monkeypatch):
    monkeypatch.setattr("wisp_backend.api.endpoints.BODY_TIMEOUT", 0.01)

    async def run():
        sent = []

        async def receive():
            await asyncio.Future()

        async def send(value):
            sent.append(value)

        async def downstream(*args):
            pytest.fail("slow input reached downstream")

        await CompletionBoundary(downstream)(
            {"type": "http", "path": "/v1/chat", "method": "POST", "headers": [(b"content-type", b"application/json")]},
            receive,
            send,
        )
        assert sent[0]["status"] == 400
        assert json.loads(sent[1]["body"])["error"]["code"] == "invalid_request"

    asyncio.run(run())


@pytest.mark.parametrize("shutdown", [False, True])
@pytest.mark.parametrize("path", ["/v1/chat", "/v1/touch"])
@pytest.mark.parametrize("provider", ["groq", "gemini", "openai"])
def test_disconnect_or_shutdown_cancels_provider_and_releases_slot(app_factory, body, shutdown, path, provider):
    body = touch_body(body) if path == "/v1/touch" else body

    async def run():
        entered = asyncio.Event()
        cancelled = asyncio.Event()

        async def upstream(request):
            entered.set()
            try:
                await asyncio.Future()
            finally:
                cancelled.set()

        app = app_factory(upstream, assistants={"default": {"provider": provider}})
        sent = []
        async with app.router.lifespan_context(app):
            service = app.state.completion_service
            read = False

            async def receive():
                nonlocal read
                if not read:
                    read = True
                    return {"type": "http.request", "body": json.dumps(body).encode(), "more_body": False}
                await entered.wait()
                if shutdown:
                    await asyncio.Future()
                return {"type": "http.disconnect"}

            async def send(value):
                sent.append(value)

            scope = {
                "type": "http",
                "asgi": {"version": "3.0"},
                "path": path,
                "method": "POST",
                "headers": [(b"content-type", b"application/json")],
                "query_string": b"",
                "scheme": "http",
                "server": ("test", 80),
                "client": ("127.0.0.1", 123),
                "http_version": "1.1",
            }
            task = asyncio.create_task(app(scope, receive, send))
            await entered.wait()
            if shutdown:
                await service.close()
            await asyncio.wait_for(task, 1)
            await asyncio.wait_for(cancelled.wait(), 1)
            with sqlite3.connect(service.ledger.path) as db:
                assert db.execute("SELECT reserved,uncertain FROM days").fetchone() == (
                    0,
                    PROFILES[provider].reservation,
                )
                assert db.execute("SELECT count(*) FROM entries WHERE state='flight'").fetchone()[0] == 0
            assert not sent

    asyncio.run(run())


@pytest.mark.parametrize("provider", ["groq", "gemini", "openai"])
def test_late_result_refines_usage_but_never_overwrites_timeout(app_factory, body, provider):
    async def run():
        release = asyncio.Event()
        entered = asyncio.Event()

        class LateProvider:
            async def complete(self, request, timeout):
                entered.set()
                try:
                    await asyncio.Future()
                except asyncio.CancelledError:
                    await release.wait()
                    return ProviderResult(json.dumps({"text": "late"}), Usage(2, 3, 5))

        app = app_factory(lambda _: pytest.fail("real upstream"), assistants={"default": {"provider": provider}})
        async with app.router.lifespan_context(app):
            service = app.state.completion_service
            service.provider = LateProvider()
            service.deadline = 0.2
            request = ChatRequest.model_validate(body)
            digest = hashlib.sha256(json.dumps(body).encode()).hexdigest()
            outcome = await service.complete(prepare_job(request), digest, asyncio.get_running_loop().time())
            assert outcome.status == 504
            assert entered.is_set(), "deadline expired before provider dispatch"
            release.set()
            while service.background:
                await asyncio.sleep(0)
            repeat = await service.complete(prepare_job(request), digest, asyncio.get_running_loop().time())
            assert repeat.status == 409
            with sqlite3.connect(service.ledger.path) as db:
                assert db.execute("SELECT requests,reserved,confirmed,uncertain FROM days").fetchone() == (1, 0, 5, 0)

    asyncio.run(run())


def test_admission_timeout_has_no_dispatch_and_settles_late_reservation(app_factory, body):
    async def run():
        release = asyncio.Event()
        app = app_factory(lambda _: pytest.fail("expired admission reached upstream"))
        async with app.router.lifespan_context(app):
            service = app.state.completion_service
            original = service.ledger.admit

            async def slow(*args):
                await release.wait()
                return await original(*args)

            service.ledger.admit = slow
            service.deadline = 0.01
            outcome = await service.complete(
                prepare_job(ChatRequest.model_validate(body)), "digest", asyncio.get_running_loop().time()
            )
            assert outcome.status == 504
            release.set()
            while service.background:
                await asyncio.sleep(0)
            with sqlite3.connect(service.ledger.path) as db:
                assert db.execute("SELECT reserved,uncertain FROM days").fetchone() == (0, RESERVATION)

    asyncio.run(run())


def test_slow_terminal_disk_write_cannot_exceed_deadline_or_cache_success(app_factory, body):
    async def run():
        release = asyncio.Event()
        app = app_factory(
            lambda _: httpx.Response(
                200,
                json={
                    "choices": [{"message": {"content": '{"text":"ok"}'}, "finish_reason": "stop"}],
                    "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
                },
            )
        )
        async with app.router.lifespan_context(app):
            service = app.state.completion_service
            original = service.ledger.settle

            async def slow(*args):
                await release.wait()
                return await original(*args)

            service.ledger.settle = slow
            service.deadline = 0.02
            request = ChatRequest.model_validate(body)
            outcome = await asyncio.wait_for(
                service.complete(prepare_job(request), "digest", asyncio.get_running_loop().time()), 0.1
            )
            assert outcome.status == 504
            release.set()
            while service.background:
                await asyncio.sleep(0)
            repeat = await service.complete(prepare_job(request), "digest", asyncio.get_running_loop().time())
            assert repeat.status == 409

    asyncio.run(run())


def test_disconnect_during_settlement_never_caches_success(app_factory, body):
    async def run():
        entered, release = asyncio.Event(), asyncio.Event()
        app = app_factory(
            lambda _: httpx.Response(
                200,
                json={
                    "choices": [{"message": {"content": '{"text":"ok"}'}, "finish_reason": "stop"}],
                    "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
                },
            )
        )
        async with app.router.lifespan_context(app):
            service = app.state.completion_service
            original = service.ledger.settle

            async def slow(*args):
                entered.set()
                await release.wait()
                return await original(*args)

            service.ledger.settle = slow
            request = ChatRequest.model_validate(body)
            task = asyncio.create_task(
                service.complete(prepare_job(request), "digest", asyncio.get_running_loop().time())
            )
            await entered.wait()
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
            release.set()
            while service.background:
                await asyncio.sleep(0)
            assert task not in service.requests
            repeat = await service.complete(prepare_job(request), "digest", asyncio.get_running_loop().time())
            assert repeat.status == 409

    asyncio.run(run())


@pytest.mark.parametrize("touch", [False, True])
def test_cached_commit_cannot_replay_success_after_deadline(app_factory, chat_completion, body, touch):
    import time

    async def run():
        app = app_factory(lambda _: httpx.Response(200, json=chat_completion()))
        async with app.router.lifespan_context(app):
            service = app.state.completion_service
            service.deadline = 0.03
            original = service.ledger._terminal

            def delayed_return(*args):
                original(*args)
                time.sleep(0.06)

            service.ledger._terminal = delayed_return
            request = TouchRequest.model_validate(touch_body(body)) if touch else ChatRequest.model_validate(body)
            first = await service.complete(prepare_job(request), "digest", asyncio.get_running_loop().time())
            assert first.status == 504
            while service.background:
                await asyncio.sleep(0)
            repeat = await service.complete(prepare_job(request), "digest", asyncio.get_running_loop().time())
            assert repeat.status == 409

    asyncio.run(run())


def test_touch_late_usage_cannot_publish_success(app_factory, body):
    async def run():
        release = asyncio.Event()
        entered = asyncio.Event()

        class LateProvider:
            async def complete(self, request, timeout):
                entered.set()
                try:
                    await asyncio.Future()
                except asyncio.CancelledError:
                    await release.wait()
                    return ProviderResult(json.dumps({"text": "late"}), Usage(2, 3, 5))

        app = app_factory(lambda _: pytest.fail("real upstream"))
        async with app.router.lifespan_context(app):
            service = app.state.completion_service
            service.provider = LateProvider()
            service.deadline = 0.2
            request = TouchRequest.model_validate(touch_body(body))
            outcome = await service.complete(prepare_job(request), "digest", asyncio.get_running_loop().time())
            assert outcome.status == 504
            assert entered.is_set(), "deadline expired before provider dispatch"
            release.set()
            while service.background:
                await asyncio.sleep(0)
            assert (
                await service.complete(prepare_job(request), "digest", asyncio.get_running_loop().time())
            ).status == 409
            with sqlite3.connect(service.ledger.path) as db:
                assert db.execute("SELECT reserved,confirmed,uncertain FROM days").fetchone() == (0, 5, 0)

    asyncio.run(run())


def test_deadline_starts_before_body_and_admission(app_factory, body):
    async def run():
        calls = []

        class Provider:
            async def complete(self, request, timeout):
                calls.append(timeout)
                return ProviderResult(
                    json.dumps(
                        {"text": "ok", "appraisal": {"category": "neutral", "intensity": "low", "confidence": "clear"}}
                    ),
                    Usage(1, 1, 2),
                )

        app = app_factory(lambda _: pytest.fail("unexpected HTTP"))
        async with app.router.lifespan_context(app):
            service = app.state.completion_service
            service.provider = Provider()
            service.deadline = 1
            request = ChatRequest.model_validate(body)
            now = asyncio.get_running_loop().time()
            assert (await service.complete(prepare_job(request), "digest", now - 1)).status == 504
            assert calls == []
            assert (await service.complete(prepare_job(request), "digest", now - 0.5)).status == 200
            assert 0 < calls[0] <= 0.5

    asyncio.run(run())
