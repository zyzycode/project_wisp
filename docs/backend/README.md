# Backend Wisp

Python/FastAPI backend находится в [backend/](../../backend). Desktop находится в `frontend/`; корневые launchers запускают обе части. Общие роли — в `.agents/agents/`, инженерные правила — в [backend/AGENTS.md](../../backend/AGENTS.md). Решение о структуре: [ADR-017](../adr/ADR-017-monorepo.md).

## Фактическая реализация

Импортирован tracked snapshot отдельного `wisp_backend` на commit `275cc8161e5f725681fdacc725708acaf74784b6`. Исходный репозиторий и его Git-история не удалены; история не объединялась с desktop. Не импортированы `.env`, `.venv`, `.git`, IDE, кеши и runtime data.

Текущий сервер предоставляет `GET /health` и `POST /v1/chat`: JSON без streaming, серверные model/prompt, strict input/output validation и безопасные errors. Groq key остаётся на сервере; история не сохраняется сервером. Desktop должен запускаться с API v1.

Перенос не является поставкой более поздней backend-ветки, описанной в `BE_P01_RESULT.md`. В этом snapshot отсутствуют v2/v3 memory/events endpoints, server-only ledger/quota/idempotency и полный lifecycle safeguards из поздней части [канонического v1-контракта](../engine/BACKEND_API_CONTRACT.md). Health означает работоспособность HTTP runtime, не готовность Groq. Gaps требуют отдельной задачи; их отсутствие не меняет canonical contract и не разрешает публичный deployment.

## Запуск из корня

Подготовка Python окружения, server `.env`, совместный запуск и все команды описаны в [корневом README](../../README.md#подготовка). Backend запускается отдельно через `node scripts/wisp.mjs dev:backend` или вместе с desktop через `node scripts/wisp.mjs dev`.

Default — `http://127.0.0.1:8000`, [Swagger](http://127.0.0.1:8000/docs). `WISP_BACKEND_PORT` выбирает loopback port; совместный launcher передаёт тот же URL desktop с API v1. `WISP_PYTHON` выбирает существующее Python окружение; без override launcher сначала ищет `backend/.venv`, затем `python` из PATH. Ключ остаётся в server `.env`/process env и не передаётся frontend.

## Proxy и TLS environment

По умолчанию `WISP_UPSTREAM_TRUST_ENV=false`: httpx не использует унаследованные `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY` и custom CA environment. Проверка TLS остаётся включённой. Это предотвращает `503 upstream_unavailable` из-за недоступного proxy в окружении процесса.

Если для сервера действительно нужен proxy или custom CA, явно установить `WISP_UPSTREAM_TRUST_ENV=true` в server `.env` и настроить соответствующие переменные окружения. Допускаются только `true`/`false`, без учёта регистра. После изменения `.env` требуется перезапуск.

## Проверки

Из корня: `node scripts/wisp.mjs check:backend` → `node scripts/wisp.mjs test:backend`; `node scripts/wisp.mjs test` проверяет обе части и launcher lifecycle. Из `backend/` те же проверки можно выполнить напрямую выбранным Python: `python -m pip check` → `python -m pytest -q`.

Тесты используют mocked provider или локальный HTTP fixture, без внешних AI-вызовов. Общие v1 JSON fixtures читаются прямо из [docs/contracts/fixtures/desktop-backend-v1/](../contracts/fixtures/desktop-backend-v1). Обязательные gates исполнителя — в [общих правилах](../../AGENTS.md#11-план-верификация-и-отчёт). `npm run build` не применяется.

Python paths собираются через `pathlib.Path`; root launcher устанавливает рабочий каталог `backend/`, чтобы разрешался импорт `wisp_backend`.
