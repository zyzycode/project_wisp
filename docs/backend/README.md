# Backend Wisp

Python/FastAPI backend находится в [backend/](../../backend/). Desktop остаётся на существующих путях в корне. Общие роли — в `.agents/agents/`, инженерные правила — в [backend/AGENTS.md](../../backend/AGENTS.md). Решение о структуре: [ADR-017](../adr/ADR-017-monorepo.md).

## Фактическая реализация

Импортирован tracked snapshot отдельного `wisp_backend` на commit `275cc8161e5f725681fdacc725708acaf74784b6`. Исходный репозиторий и его Git-история не удалены; история не объединялась с desktop. Не импортированы `.env`, `.venv`, `.git`, IDE, кеши и runtime data.

Текущий сервер предоставляет `GET /health` и `POST /v1/chat`: JSON без streaming, серверные model/prompt, strict input/output validation и безопасные errors. Groq key остаётся на сервере; история не сохраняется сервером. Desktop должен запускаться с API v1.

Перенос не является поставкой более поздней backend-ветки, описанной в `BE_P01_RESULT.md`. В этом snapshot отсутствуют v2/v3 memory/events endpoints, server-only ledger/quota/idempotency и полный lifecycle safeguards из поздней части [канонического v1-контракта](../engine/BACKEND_API_CONTRACT.md). Health означает работоспособность HTTP runtime, не готовность Groq. Gaps требуют отдельной задачи; их отсутствие не меняет canonical contract и не разрешает публичный deployment.

## Запуск из PowerShell

Все команды ниже выполняются из корня `project_wisp`. Python 3.10+; зависимости — [requirements](../../backend/requirements.txt), тестовые — [requirements-dev](../../backend/requirements-dev.txt).

```powershell
python -m venv backend/.venv
./backend/.venv/Scripts/python.exe -m pip install -r backend/requirements-dev.txt
Copy-Item backend/.env.example backend/.env
```

В локальном `backend/.env` установить собственный `GROQ_API_KEY`. Не коммитить и не печатать его. Затем:

```powershell
Push-Location backend
./.venv/Scripts/python.exe main.py
Pop-Location
```

Default — `http://127.0.0.1:8000`, [Swagger](http://127.0.0.1:8000/docs). Если старый сервер ещё занимает 8000, для временной параллельной проверки:

```powershell
Push-Location backend
./.venv/Scripts/python.exe -m uvicorn main:app --host 127.0.0.1 --port 8001
Pop-Location
```

В другом терминале из корня запустить desktop с тем же портом:

```powershell
$env:WISP_BACKEND_URL = 'http://127.0.0.1:8000'
$env:WISP_BACKEND_API_VERSION = '1'
$env:WISP_AI_EVENTS_ENABLED = 'false'
npm run dev
```

Без URL desktop использует mock. HTTP loopback допустим только в development; packaged/remote deployment требует HTTPS. Настройки desktop читаются Main, не Renderer; npm/Vite не загружает server `.env`.

## Proxy и TLS environment

По умолчанию `WISP_UPSTREAM_TRUST_ENV=false`: httpx не использует унаследованные `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY` и custom CA environment. Проверка TLS остаётся включённой. Это предотвращает `503 upstream_unavailable` из-за недоступного proxy в окружении процесса.

Если для сервера действительно нужен proxy или custom CA, явно установить `WISP_UPSTREAM_TRUST_ENV=true` в server `.env` и настроить соответствующие переменные окружения. Допускаются только `true`/`false`, без учёта регистра. После изменения `.env` требуется перезапуск.

## Проверки

Из `backend/`:

```powershell
./.venv/Scripts/python.exe -m pip check
./.venv/Scripts/python.exe -m pytest -q
```

Тесты используют mocked provider или локальный HTTP fixture, без внешних AI-вызовов. Общие v1 JSON fixtures читаются прямо из [docs/contracts/fixtures/desktop-backend-v1/](../contracts/fixtures/desktop-backend-v1/). Desktop gates и reviewer restrictions — в [общих правилах](../../AGENTS.md#11-план-верификация-и-отчёт). `npm run build` не применяется.

На Linux/macOS использовать `backend/.venv/bin/python` вместо Windows executable. Python paths собираются через `pathlib.Path`; импорт `wisp_backend` разрешается из рабочего каталога `backend/`.
