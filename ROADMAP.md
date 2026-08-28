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
| 0 — Project Scaffolding | done | `electron-platform` | Репозиторий, Electron + React + TypeScript + Vite + Tailwind, tooling. |
| 1 — Clean Architecture Base | done | `architect` | Слои, каталоги, правила изоляции и placeholder-модули. |
| 2 — Transparent Desktop Pet | done | `electron-platform` | Frameless transparent overlay с platform-aware window behavior. |
| 3 — Dragging and Positioning | done | `domain-behavior` + `electron-platform` | Dragging, bounds и сохранение позиции. |
| 4 — Character Rendering | done | `ui-specialist` | SVG/vector renderer Wisp с базовыми scale/theme. |
| 5 — Animation State Machine | done | `domain-behavior` | Animation FSM, transitions и interrupt rules. |
| 6 — Basic Character Behavior | done | `domain-behavior` | Idle, wander, sit и sleep behavior. |
| 7 — Interaction | done | `domain-behavior` + `ui-specialist` | Click, double-click, context menu и reactions. |
| 8 — Local Chat UI | done | `ui-specialist` | Speech bubble и local chat input. |
| 9 — Provider & Intent Contracts | done | `architect` | Markdown contracts для provider responses, behavior intents и animation intents. |
| 10 — Mock AI & Dialogue Loop | in_progress | `mock-ai-provider` | Offline `MockAIProvider`, thinking state и reply flow. |
| 11 — Character Engine v2 | next | `domain-behavior` + `architect` | Needs, Relationships (friendship/love), Traits, Intimacy и stimuli. |
| 12 — Animation & Reaction Pack | later | `domain-behavior` | Более богатые reactions, idle variety и sleep/wake animation rules. |
| 13 — Render Engine & Asset Pipeline | later | `ui-specialist` | Sprite sheet pipeline, props, layers, themes и renderer debug tools. |
| 14 — Offline Memory & Relationship | later | `data-memory` | SQLite memory, bounded history, local fact extraction и clear memory. |
| 15 — Desktop Life Behaviors | later | `domain-behavior` | Quiet mode, cooldowns, habits и менее навязчивая автономность. |
| 16 — Settings & Control Surface | later | `ui-specialist` | Behavior, appearance, memory controls и dev-only debug panel. |
| 17 — External AI Contract Readiness | future | `architect` + `mock-ai-provider` | Только client-side контракт будущего adapter; backend остаётся отдельно. |
| 18 — Stability & Performance Hardening | future | `tester` | Long-session stability, cleanup checks и Linux Wayland/X11 fallbacks. |
| 19 — Production Packaging | future | `electron-platform` | Linux package baseline, затем готовность Windows/macOS release. |

## Текущий фокус

Контракты движка зафиксированы в `docs/engine/`. Текущая фаза реализации — **Phase 10 (Mock AI & Dialogue Loop)**, затем переход к **Phase 11 (Character Engine v2)**.

Следующий рабочий шаг:
- Выполнение задач Phase 10 (`P10-T02` и далее) в `.agents/tasks/README.md`.
- Подготовка к контрактам и реализации Phase 11 на основе `docs/engine/CHARACTER_ENGINE.md`.

## Заметки по фазам

### Phase 9 — Provider & Intent Contracts
Цель: убедиться, что данные AI/provider не просачиваются в UI decisions. `IAIProvider` возвращает semantic response DTO; application переводит их в `BehaviorIntent`; domain/character logic выбирает поведение; animation/rendering получает presentation-ready state.

Документы-источники:
- `docs/engine/README.md`;
- `docs/engine/AI_PROVIDER_CONTRACT.md`;
- `docs/engine/CHARACTER_ENGINE.md`;
- `docs/engine/BEHAVIOR_INTENTS.md`;
- `docs/engine/ANIMATION_ENGINE.md`.
