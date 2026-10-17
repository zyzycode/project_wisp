# Project Wisp

Desktop AI-компаньон на Electron + React + TypeScript и Python/FastAPI backend. Desktop runtime и локальная память работают offline-first; внешние AI-вызовы идут через Main и сервер. Windows — первая платформа приёмки, Linux/macOS сохраняются с capability fallback.

## Структура

- `frontend/` — desktop-код, тесты, ассеты, документация в `frontend/docs/`, независимый `asset-pipeline/`, npm dependencies, Vite/Electron/TypeScript configs и desktop tooling.
- `backend/` — серверный Python-код, документация в `backend/docs/`, pytest, requirements и локальный server `.env`.
- `docs/` — общие продуктовые и межкомпонентные материалы. Wire-контракты — в `docs/contracts/`, общие fixtures — в `docs/contracts/fixtures/`.
- `.agents/agents/` — общие роли. `AGENTS.md` — общие правила, `frontend/AGENTS.md` и `backend/AGENTS.md` — scoped правила.
- `scripts/` — только корневые launchers и их тесты. Корневой Node CLI `scripts/wisp.mjs` запускает команды без новых зависимостей; package.json и lockfile находятся только в `frontend/`. npm dependencies и их lockfile — в `frontend/`, Python-окружение — в `backend/.venv/`.

## Подготовка

Проверенный runtime: Node.js 24, npm 10+, Python 3.12+. Тесты памяти требуют `node:module.registerHooks`; Node 22.13 недостаточен. Все команды ниже выполняются из корня репозитория.

```powershell
npm --prefix frontend install
python -m venv backend/.venv
./backend/.venv/Scripts/python.exe -m pip install -r backend/requirements-dev.txt
Copy-Item backend/.env.example backend/.env
```

В локальном `backend/.env` задать `GROQ_API_KEY`. Секреты не коммитить. На Linux/macOS вместо Windows Python executable использовать `backend/.venv/bin/python`.

## Команды из корня

| Команда | Действие |
|---|---|
| `node scripts/wisp.mjs dev` | Запустить backend и desktop вместе; Ctrl+C останавливает оба |
| `node scripts/wisp.mjs dev:frontend` | Только desktop; без `WISP_BACKEND_URL` используется mock |
| `node scripts/wisp.mjs dev:backend` | Только backend на loopback |
| `node scripts/wisp.mjs typecheck` | Desktop TypeScript check |
| `node scripts/wisp.mjs test` | Launcher tests → desktop tests → Python manifest tests → backend pip check → backend pytest |
| `node scripts/wisp.mjs test:frontend` | Только desktop tests; последующие аргументы передаются Vitest |
| `node scripts/wisp.mjs test:backend` | Только серверные tests, без внешнего AI |
| `node scripts/wisp.mjs check:backend` | Проверка установленных Python dependencies |
| `node scripts/wisp.mjs test:tooling` | Проверка lifecycle и конфигурации корневых launchers |
| `node scripts/wisp.mjs test:python` | Python unit-tests desktop manifest tooling |
| `node scripts/wisp.mjs sprites:validate` | Read-only проверка готовых ассетов и manifest |

Совместный запуск задаёт desktop адрес собственного backend, API v1 и отключает v3 events. Это сохранённый default launcher; поддерживаемые сервером версии описаны в [backend docs](backend/docs/README.md#фактическая-реализация). Default — `http://127.0.0.1:8000`; если порт занят старым сервером:

```powershell
$env:WISP_BACKEND_PORT = '8001'
node scripts/wisp.mjs dev
```

Launcher выбирает Python из `backend/.venv`, если он есть, иначе `python` из PATH. Для существующего внешнего окружения можно задать `$env:WISP_PYTHON = 'C:/path/to/python.exe'`. Этот же executable используется в desktop manifest test. Для отдельных desktop Python-скриптов команда `python` должна быть доступна в PATH.

Если backend не запускается или один компонент завершает работу, совместный launcher останавливает второй и возвращает код завершившегося компонента. Для изменения Python-кода перезапустить совместный запуск; server `.env` не загружается frontend. [Proxy/TLS configuration и фактические server gaps](backend/docs/README.md).

При раздельном запуске frontend с реальным сервером:

```powershell
$env:WISP_BACKEND_URL = 'http://127.0.0.1:8000'
$env:WISP_BACKEND_API_VERSION = '1'
$env:WISP_AI_EVENTS_ENABLED = 'false'
node scripts/wisp.mjs dev:frontend
```

HTTP loopback допустим в development; packaged/remote backend требует HTTPS. Build-команды находятся в `frontend/package.json`, но `npm run build` запрещён инженерными правилами и не используется для verification.

## Документация

- [AGENTS.md](AGENTS.md) — общие границы, роли и gates.
- [docs/README.md](docs/README.md) — navigator минимального контекста.
- [Архитектура](ARCHITECTURE.md), [ADR-017](docs/adr/ADR-017-monorepo.md) — структура и границы процессов.
- [Frontend](frontend/docs/README.md) — движки, сценарии и Windows-приёмка.
- [Backend](backend/docs/README.md) — server setup и текущие gaps.
- [Общие API-контракты](docs/contracts/README.md) — wire v1/v2/v3 и fixtures.
- [GitHub Issues](https://github.com/zyzycode/project_wisp/issues) и [Project](https://github.com/users/zyzycode/projects/1) — задачи и статусы.

Графику предоставляет внешний художник-человек. Готовые спрайты — `frontend/public/assets/sprites/`; при отсутствии ассета — fallback и требования в отчёте задачи. `frontend/asset-pipeline/` сохраняет независимые инструкции и не запускается общим dev/test; `discord_orcestrations/` остаётся отдельным внешним scope.
