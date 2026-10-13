# Backend Wisp

Python/FastAPI backend находится в [backend/](..). Desktop находится в `frontend/`; корневые launchers запускают обе части. Общие роли — в `.agents/agents/`, инженерные правила — в [backend/AGENTS.md](../AGENTS.md). Решение о структуре: [ADR-017](../../docs/adr/ADR-017-monorepo.md).

Серверная документация находится в `backend/docs/`. Единые [wire-контракты v1/v2/v3 и fixtures](../../docs/contracts/README.md) остаются общими для обоих приложений.

## Фактическая реализация

Импортирован tracked snapshot отдельного `wisp_backend` на commit `275cc8161e5f725681fdacc725708acaf74784b6`. Исходный репозиторий и его Git-история не удалены; история не объединялась с desktop. Не импортированы `.env`, `.venv`, `.git`, IDE, кеши и runtime data.

Текущий сервер предоставляет `GET /health`, `POST /v1/chat` и `POST /v1/touch`: JSON без streaming, серверные model/prompt, strict input/output validation и безопасные errors. Groq key остаётся на сервере; история не сохраняется сервером. Desktop должен запускаться с API v1. Касание возвращает короткую AI-реплику по [контракту касаний](../../docs/contracts/AI_EVENTS_CONTRACT.md#8-явное-касание-v1).

В [#62](https://github.com/zyzycode/project_wisp/issues/62) восстановлены общий server-only SQLite ledger, квоты, защита от повторной отправки и lifecycle safeguards для chat/touch по [каноническому v1-контракту](../../docs/contracts/BACKEND_API_CONTRACT.md). Конфигурация, сроки хранения и ограничения одного ASGI worker описаны в [operator-документации](OPERATIONS.md). В текущей поставке ещё отсутствуют v2/v3 memory/events endpoints из [исторического BE-P01](archive/BE_P01_RESULT.md). Health означает работоспособность HTTP runtime, не готовность Groq; успешные mocked tests не разрешают публичный deployment.

План восстановления и обязательные Implementation consequences: [BE-A02 #61](BE_A02_RESULT.md). Перенос выполняется последовательно [#62](https://github.com/zyzycode/project_wisp/issues/62) → [#63](https://github.com/zyzycode/project_wisp/issues/63) → [#64](https://github.com/zyzycode/project_wisp/issues/64); архитектурный результат не означает готовую серверную поставку или deployment.

## Запуск из корня

Подготовка Python окружения, server `.env`, совместный запуск и все команды описаны в [корневом README](../../README.md#подготовка). Backend запускается отдельно через `node scripts/wisp.mjs dev:backend` или вместе с desktop через `node scripts/wisp.mjs dev`.

Default — `http://127.0.0.1:8000`, [Swagger](http://127.0.0.1:8000/docs). `WISP_BACKEND_PORT` выбирает loopback port; совместный launcher передаёт тот же URL desktop с API v1. `WISP_PYTHON` выбирает существующее Python окружение; без override launcher сначала ищет `backend/.venv`, затем `python` из PATH. Ключ остаётся в server `.env`/process env и не передаётся frontend.

## Proxy и TLS environment

По умолчанию `WISP_UPSTREAM_TRUST_ENV=false`: httpx не использует унаследованные `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY` и custom CA environment. Проверка TLS остаётся включённой. Это предотвращает `503 upstream_unavailable` из-за недоступного proxy в окружении процесса.

Если для сервера действительно нужен proxy или custom CA, явно установить `WISP_UPSTREAM_TRUST_ENV=true` в server `.env` и настроить соответствующие переменные окружения. Допускаются только `true`/`false`, без учёта регистра. После изменения `.env` требуется перезапуск.

## Проверки

Из корня: `node scripts/wisp.mjs check:backend` → `node scripts/wisp.mjs test:backend`; `node scripts/wisp.mjs test` проверяет обе части и launcher lifecycle. Из `backend/` те же проверки можно выполнить напрямую выбранным Python: `python -m pip check` → `python -m pytest -q`.

Тесты используют mocked provider или локальный HTTP fixture, без внешних AI-вызовов. Общие v1 JSON fixtures читаются прямо из [docs/contracts/fixtures/desktop-backend-v1/](../../docs/contracts/fixtures/desktop-backend-v1). Обязательные gates исполнителя — в [общих правилах](../../AGENTS.md#11-план-верификация-и-отчёт). `npm run build` не применяется.

Python paths собираются через `pathlib.Path`; root launcher устанавливает рабочий каталог `backend/`, чтобы разрешался импорт `wisp_backend`.
