# Project Wisp

Desktop AI-компаньон на Electron + React + TypeScript: персонаж живёт в прозрачном окне, реагирует на действия пользователя и выражает состояние через анимации. Первая целевая платформа — Windows; Linux (Ubuntu, Wayland/X11) и macOS сохраняются с capability fallback.

Целевая архитектура включает desktop-клиент и backend. Runtime персонажа и локальные данные сохраняют offline-first поведение; сетевые функции могут требовать подключения. Клиент обращается к backend через адаптеры в Main, AI — через `IAIProvider`. Renderer изолирован от сети, Node.js и persistence. Потоки и границы описаны в [архитектуре проекта](ARCHITECTURE.md).

## Разработка

Окружение: Node.js 20+, npm 10+. Доступные команды определены в [package.json](package.json).

```bash
npm install
npm run dev
```

Проверки выбираются по роли и изменению из [AGENTS.md](AGENTS.md#11-план-верификация-и-отчёт):

- Реализация: `npm run typecheck`, затем `npm test`.
- Независимое review любой задачи: `npm run typecheck` и аудит diff; для документации также ссылки.
- Docs-only исполнение: ссылки и diff; правило reviewer указано выше.

Build-верификация пока не применяется; `npm run build` запрещён правилами проекта.

## Документация и задачи

- [AGENTS.md](AGENTS.md) — обязательные архитектурные ограничения, роли и verification.
- [docs/README.md](docs/README.md) — выбор минимального контекста по задаче.
- [Engine contracts](docs/engine/README.md) — владельцы правил движков и ссылки на спецификации.
- [ARCHITECTURE.md](ARCHITECTURE.md) — обзор для человека, необязательный агентный контекст.
- [GitHub Issues](https://github.com/zyzycode/project_wisp/issues) и [Project](https://github.com/users/zyzycode/projects/1) — текущие фазы, приоритеты, зависимости и статусы. Локальную копию roadmap не ведём.

Готовые спрайты художник-человек размещает в `public/assets/sprites/`; их формат задаёт [Render contract](docs/engine/RENDER_ENGINE.md). Приложение использует fallback для отсутствующих ассетов и [реестр запросов](docs/art/SPRITE_REQUESTS.md). `asset-pipeline/` и `discord_orcestrations/` — отдельные внешние скоупы.
