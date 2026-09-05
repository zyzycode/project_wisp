# Roadmap Project Wisp

Документ фиксирует общий продуктово-технический план проекта.

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
