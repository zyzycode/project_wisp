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
| 3 — Dragging and Positioning | done | `domain-behavior` + `app-developer` | Dragging, bounds и сохранение позиции. |
| 4 — Character Rendering | done | `app-developer` | SVG/vector renderer Wisp с базовыми scale/theme. |
| 5 — Animation State Machine | done | `domain-behavior` | Animation FSM, transitions и interrupt rules. |
| 6 — Basic Character Behavior | done | `domain-behavior` | Idle, wander, sit и sleep behavior. |
| 7 — Interaction | done | `domain-behavior` + `app-developer` | Click, double-click, context menu и reactions. |
| 8 — Local Chat UI | done | `app-developer` | Speech bubble и local chat input. |
| 9 — Provider & Intent Contracts | done | `architect` | Markdown contracts для provider responses, behavior intents и animation intents. |
| 10 — Mock AI & Dialogue Loop | done | `app-developer` | Offline `MockAIProvider`, thinking state и reply flow. |
| 11 — Character Engine v2 | done | `domain-behavior` + `architect` | Needs, Relationships (friendship/love), Traits, Intimacy и stimuli. |
| 12 — Animation & Reaction Pack | done | `architect` + `domain-behavior` | Синхронизация контракта с Character Engine v2, реакции, idle variety, sleep rules. |
| 13 — Render Engine & Asset Pipeline | done | `architect` + `app-developer` | RENDER_ENGINE.md, спрайтовый пайплайн, слои, fallback, структурированный логгер и Debug HUD. |
| 14 — Shimeji & Advanced Autonomy | in_progress | `domain-behavior` + `app-developer` | Базовая локомоция (сидеть/лежать/бег/прыжки), Boredom, кулдауны, физика броска, Gaze Tracking, Zoomies. |
| 15 — Offline Memory & Persistence | later | `app-developer` | Контракт MEMORY_ENGINE.md готов. SQLite, bounded history, facts, state restore, clear memory. |
| 16 — Settings & Control Surface | later | `app-developer` | Behavior, appearance, memory controls и расширенная dev-only debug panel. |
| 17 — External AI Contract Readiness | future | `architect` + `app-developer` | Только client-side контракт будущего adapter; backend остаётся отдельно. |
| 18 — Stability & Performance Hardening | future | `reviewer` | Long-session stability, cleanup checks и Linux Wayland/X11 fallbacks. |
| 19 — Production Packaging | future | `app-developer` | Linux package baseline, затем готовность Windows/macOS release. |

## Текущий фокус

Текущая фаза реализации — **Phase 14 (Shimeji & Advanced Autonomy)**.

Следующий рабочий шаг:
- **`P14-S01` (`domain-behavior`):** Внедрение расширенных локомоций и состояний FSM (`sit`, `stand_up`, `lie_down`, `get_up`, `run`, `jump`, `fall`, `land`, `crawl`), шкалы `Needs.boredom` и кулдаунов `RepetitionPenalty`.
