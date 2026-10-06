# Project Wisp

Desktop AI-компаньон на Electron + React + TypeScript: персонаж живёт в прозрачном окне, реагирует на действия пользователя и выражает состояние через анимации. Первая целевая платформа — Windows; Linux (Ubuntu, Wayland/X11) и macOS сохраняются с capability fallback.

Репозиторий содержит desktop-клиент и Python/FastAPI backend в `backend/`, с отдельными runtime и зависимостями. Runtime персонажа и локальные данные сохраняют offline-first поведение; сетевые функции могут требовать подключения. Клиент обращается к backend через адаптеры в Main, AI — через `IAIProvider`. Renderer изолирован от сети, Node.js и persistence. Потоки и границы описаны в [архитектуре проекта](ARCHITECTURE.md).

## Структура репозитория

- `src/`, `public/`, `tests/` — desktop и его тесты/ассеты.
- `backend/` — серверный Python-код, pytest и requirements.
- `docs/` — общая документация; `docs/backend/` — запуск и серверные особенности.
- `docs/engine/`, `docs/contracts/fixtures/` — canonical API contracts и общие fixtures.
- `AGENTS.md` — общие правила; `src/AGENTS.md`, `tests/AGENTS.md`, `public/AGENTS.md`, `backend/AGENTS.md` — правила соответствующих областей; `.agents/agents/` — общие роли.

## Разработка desktop

Проверенное окружение: Node.js 24, npm 10+. Тесты памяти требуют `node:module.registerHooks`; Node 22.13 для них недостаточен. Команда `python3` должна разрешаться в установленный Python для существующего теста валидации manifest. Доступные команды определены в [package.json](package.json).

```bash
npm install
npm run dev
```

Проверки выбираются по роли и изменению из [AGENTS.md](AGENTS.md#11-план-верификация-и-отчёт):

- Desktop реализация: `npm run typecheck`, затем `npm test`.
- Независимое review любой задачи: `npm run typecheck` и аудит diff; для документации также ссылки.
- Docs-only исполнение: ссылки и diff; правило reviewer указано выше.

Backend setup, проверка и подключение desktop описаны в [docs/backend/README.md](docs/backend/README.md). Текущий сервер поддерживает API v1; для живого диалога перед `npm run dev`:

```powershell
$env:WISP_BACKEND_URL = 'http://127.0.0.1:8000'
$env:WISP_BACKEND_API_VERSION = '1'
$env:WISP_AI_EVENTS_ENABLED = 'false'
```

Без `WISP_BACKEND_URL` используется mock. Server `.env` находится в `backend/` и не загружается desktop. Backend checks: `python -m pip check`, затем `python -m pytest -q` из `backend/` с его Python окружением. Импортированный сервер ещё не реализует поздние quota/memory/events capabilities; [известные gaps](docs/backend/README.md#фактическая-реализация) не считаются принятыми.

Build-верификация пока не применяется; `npm run build` запрещён правилами проекта.

## Документация и задачи

- [AGENTS.md](AGENTS.md) — обязательные архитектурные ограничения, роли и verification.
- [docs/README.md](docs/README.md) — выбор минимального контекста по задаче.
- [Engine contracts](docs/engine/README.md) — владельцы правил движков и ссылки на спецификации.
- [ARCHITECTURE.md](ARCHITECTURE.md) — обзор для человека, необязательный агентный контекст.
- [GitHub Issues](https://github.com/zyzycode/project_wisp/issues) и [Project](https://github.com/users/zyzycode/projects/1) — текущие фазы, приоритеты, зависимости и статусы. Локальную копию roadmap не ведём.

Готовые спрайты художник-человек размещает в `public/assets/sprites/`; их формат задаёт [Render contract](docs/engine/RENDER_ENGINE.md). Приложение использует fallback для отсутствующих ассетов и [реестр запросов](docs/art/SPRITE_REQUESTS.md). `asset-pipeline/` и `discord_orcestrations/` — отдельные внешние скоупы.
