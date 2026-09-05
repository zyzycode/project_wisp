# Project Wisp

**Project Wisp** — интерактивный desktop AI-компаньон для Linux, Windows и macOS. Wisp живёт на рабочем столе в прозрачном Electron-окне, реагирует на действия пользователя, выражает эмоции через анимации, ведёт локальный диалог и постепенно получает офлайн-память.

Текущий репозиторий `project_wisp` — только desktop-клиент. Backend, dev proxy, auth/billing server logic и реальные AI SDK здесь не реализуются. На текущем этапе AI-поведение имитируется через `MockAIProvider`; будущая реальная AI-интеграция может подключаться только как client-side adapter к внешнему backend-контракту из отдельного проекта.

---

## Текущий фокус

- Desktop-first / offline-first MVP.
- Один основной персонаж Wisp с поведением, эмоциональным тоном, анимациями и props.
- Sprite sheets используются через общий [render contract](docs/engine/RENDER_ENGINE.md).
- Локальная persistence принадлежит Main-процессу; полноценная память через SQLite запланирована отдельной фазой.
- Строгая изоляция Renderer от Node.js, Electron Main и SQLite.

---

## Документация

- [AGENTS.md](AGENTS.md) — главные правила разработки и ограничения репозитория.
- [docs/README.md](docs/README.md) — навигатор по областям и минимальным маршрутам чтения.
- [ROADMAP.md](ROADMAP.md) — фазовый план работ и ведущие агенты по фазам.
- [ARCHITECTURE.md](ARCHITECTURE.md) — обзор устройства приложения для людей: схемы, объяснения процессов и ссылки на технические источники.
- [.agents/](.agents/) — инструкции ролей, тематические rules и повторяемые сценарии для AI-агентов.
- `docs/engine/` — спецификации движков и индекс готовых/planned contract-документов.
- [asset-pipeline/](asset-pipeline/README.md) — отдельная область создания и обработки спрайтов со своим локальным агентом; он сохраняет готовые PNG сразу в рабочие папки, не изменяя манифест и код приложения.

---

## Требования к окружению

- **Node.js:** `v20+` (рекомендуется `v22.x`)
- **npm:** `v10+`
- **ОС:** Ubuntu Linux (X11 / Wayland), Windows 10/11, macOS

---

## Установка

```bash
npm install
```

---

## Команды разработки

Запуск в режиме разработки:

```bash
npm run dev
```

Запуск тестов:

```bash
npm test
```

Запуск тестов в watch-режиме:

```bash
npx vitest
```

Проверка типов:

```bash
npm run typecheck
```

Проверка типов Main / Preload / tooling:

```bash
npm run typecheck:node
```

Проверка типов Renderer:

```bash
npm run typecheck:web
```

Production build:

```bash
npm run build
```

Очистка артефактов сборки:

```bash
npm run clean
```

## Статусы фаз

- `done` — фаза реализована, протестирована и принята.
- `in_progress` — фаза выполняется прямо сейчас.
- `review` — артефакты готовы и проходят review/gate.
- `next` — следующая очередь реализации.
- `later` — понятная фаза бэклога, которая ждёт своей очереди.
- `future` — концептуальный горизонт, детали которого не фиксируются раньше времени.

## Сводная таблица

| Фаза | Статус | Основной исполнитель | Краткая суть |
|---|---|---|---|
| 0 — Project Scaffolding | done | `app-developer` | Репозиторий, Electron + React + TypeScript + Vite + Tailwind, tooling. |
| 1 — Clean Architecture Base | done | `architect` | Слои, каталоги, правила изоляции и placeholder-модули. |
| 2 — Transparent Desktop Pet | done | `app-developer` | Frameless transparent overlay с platform-aware window behavior. |
| 3 — Dragging and Positioning | done | `app-developer` | Dragging, bounds и сохранение позиции. |
| 4 — Character Rendering | done | `app-developer` | SVG/vector renderer Wisp с базовыми scale/theme. |
| 5 — Animation State Machine | done | `app-developer` | Animation FSM, transitions и interrupt rules. |
| 6 — Basic Character Behavior | done | `app-developer` | Idle, wander, sit и sleep behavior. |
| 7 — Interaction | done | `app-developer` | Click, double-click, context menu и reactions. |
| 8 — Local Chat UI | done | `app-developer` | Speech bubble и local chat input. |
| 9 — Provider & Intent Contracts | done | `architect` | Markdown contracts для provider responses, behavior intents и animation intents. |
| 10 — Mock AI & Dialogue Loop | done | `app-developer` | Offline `MockAIProvider`, thinking state и reply flow. |
| 11 — Character Engine v2 | done | `architect` + `app-developer` | Needs, Relationships (friendship/love), Traits, Intimacy и stimuli. |
| 12 — Animation & Reaction Pack | done | `architect` + `app-developer` | Синхронизация контракта с Character Engine v2, реакции, idle variety, sleep rules. |
| 13 — Render Engine | done | `architect` + `app-developer` | RENDER_ENGINE.md, слои, fallback, структурированный логгер и Debug HUD. |
| 14 — Shimeji & Autonomy | in_progress | `architect` + `app-developer` | Единый Main/Application runtime автономности, живые рутины Explore/Rest/Observe и surface-aware перемещение. |
| 15 — Offline Memory & Persistence | next | `app-developer` | Контракт MEMORY_ENGINE.md готов. SQLite, bounded history, facts, state restore, clear memory. |
| 16 — Settings & Control Surface | later | `app-developer` | Behavior, appearance, memory controls и расширенная dev-only debug panel. |
| 17 — External AI Contract Readiness | future | `architect` + `app-developer` | Только client-side контракт будущего adapter; backend остаётся отдельно. |
| 18 — Stability & Performance Hardening | future | `reviewer` | Long-session stability, cleanup checks и Linux Wayland/X11 fallbacks. |
| 19 — Production Packaging | future | `app-developer` | Linux package baseline, затем готовность Windows/macOS release. |

## Текущий фокус

**Phase 14 (Shimeji & Autonomy):** после завершения переноса autonomy loop фокус перешёл на живые автономные рутины и поверхности окружения. Ближайшие независимые slices — `Observe Cursor`, экранный `Explore` и architect gate внешних окон; затем edge traversal, Windows window-support и объединённые Explore/Rest routines. Фактические карточки, зависимости и статусы ведутся в [GitHub Project](https://github.com/users/zyzycode/projects/1).
