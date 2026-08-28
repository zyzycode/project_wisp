# ROADMAP.md — Project Wisp

Roadmap описывает направление продукта, а не список задач реализации. Подробные карточки задач держатся в `.agents/tasks/README.md` только для активной фазы.

## Северная звезда продукта

Project Wisp — offline-first desktop AI-компаньон: пользователь устанавливает приложение, запускает его, и персонаж живёт на рабочем столе без пользовательских API-ключей, аккаунтов у внешних AI-провайдеров, локальных серверов или облачной настройки.

Скоуп этого репозитория: кроссплатформенный Electron desktop client для Linux, Windows и macOS. Базовая среда разработки — Ubuntu Linux.

Жёстко вне скоупа этого репозитория:

- backend/proxy/server implementation;
- официальные внешние AI SDK в desktop-клиенте;
- пользовательские AI API-ключи;
- server-side auth/billing;
- cloud memory sync.

## Обзор фаз

| Фаза | Статус | Исполнитель | Результат |
|---|---|---|---|
| 0 — Repository / Architecture Setup | done | `project-manager` + `architect` | Проектные правила, роли и стартовая архитектура готовы. |
| 1 — Electron Shell | done | `electron-platform` | Electron + Vite + React + TypeScript shell с typed IPC и изоляцией. |
| 2 — Transparent Desktop Pet | done | `electron-platform` | Frameless transparent overlay с platform-aware window behavior. |
| 3 — Dragging and Positioning | done | `domain-behavior` + `electron-platform` | Dragging, bounds и сохранение позиции. |
| 4 — Character Rendering | done | `ui-specialist` | SVG/vector renderer Wisp с базовыми scale/theme. |
| 5 — Animation State Machine | done | `domain-behavior` | Animation FSM, transitions и interrupt rules. |
| 6 — Basic Character Behavior | done | `domain-behavior` | Idle, wander, sit и sleep behavior. |
| 7 — Interaction | done | `domain-behavior` + `ui-specialist` | Click, double-click, context menu и reactions. |
| 8 — Local Chat UI | done | `ui-specialist` | Speech bubble и local chat input. |
| 9 — Provider & Intent Contracts | review | `architect` | Markdown contracts для provider responses, behavior intents и animation intents. |
| 10 — Mock AI & Dialogue Loop | next | `mock-ai-provider` | Offline `MockAIProvider`, thinking state и reply flow. |
| 11 — Character Engine v2 | later | `domain-behavior` | Traits, mood, energy, needs и stimuli. |
| 12 — Animation & Reaction Pack | later | `domain-behavior` | Более богатые reactions, idle variety и sleep/wake animation rules. |
| 13 — Render Engine & Asset Pipeline | later | `ui-specialist` | Sprite sheet pipeline, props, layers, themes и renderer debug tools. |
| 14 — Offline Memory & Relationship | later | `data-memory` | SQLite memory, bounded history, local fact extraction и clear memory. |
| 15 — Desktop Life Behaviors | later | `domain-behavior` | Quiet mode, cooldowns, habits и менее навязчивая автономность. |
| 16 — Settings & Control Surface | later | `ui-specialist` | Behavior, appearance, memory controls и dev-only debug panel. |
| 17 — External AI Contract Readiness | future | `architect` + `mock-ai-provider` | Только client-side контракт будущего adapter; backend остаётся отдельно. |
| 18 — Stability & Performance Hardening | future | `tester` | Long-session stability, cleanup checks и Linux Wayland/X11 fallbacks. |
| 19 — Production Packaging | future | `electron-platform` | Linux package baseline, затем готовность Windows/macOS release. |

## Текущий фокус

Phase 9 contracts уже написаны, их нужно отревьюить перед продолжением реализации.

Следующий gate:

- `P09-G01` в `.agents/tasks/README.md`;
- Исполнитель: `code-reviewer`;
- Scope: только consistency markdown contracts.

После этого начинается Phase 10 — первый реальный AI-facing implementation slice, всё ещё полностью offline и на базе `MockAIProvider`.

## Заметки по фазам

### Phase 9 — Provider & Intent Contracts

Цель: убедиться, что AI/provider data не просачивается в UI decisions. `IAIProvider` возвращает semantic response DTO; application переводит их в `BehaviorIntent`; domain/character logic выбирает поведение; animation/rendering получает presentation-ready state.

Документы-источники:

- `docs/engine/README.md`;
- `docs/engine/AI_PROVIDER_CONTRACT.md`;
- `docs/engine/BEHAVIOR_INTENTS.md`;
- `docs/engine/ANIMATION_ENGINE.md`.

Условие завершения: docs review подтверждает, что contracts не требуют backend code, external SDK, UI asset decisions внутри providers или provider-specific payloads в Renderer.

### Phase 10 — Mock AI & Dialogue Loop

Цель: сделать так, чтобы Wisp отвечал локально и ощущался живым до появления реального AI backend.

Минимальный срез:

- typed `IAIProvider` port и DTO;
- local `MockAIProvider`;
- simulated thinking/latency;
- deterministic response categories;
- mapper из provider response в `BehaviorIntent`;
- tests для main reply и fallback scenarios.

### Поздние фазы

Поздние фазы намеренно остаются краткими summaries, пока не станут активными. Когда фаза переходит в `next`, Project Manager раскрывает только первые несколько executable task cards в `.agents/tasks/README.md`.

## Правила поддержки roadmap

- Держать этот файл короче 140 строк.
- Не дублировать task-level acceptance criteria.
- Не добавлять speculative subtasks для фаз дальше, чем на одну фазу вперёд.
- Использовать `docs/engine/*.md` для stable contracts, а `.agents/tasks/README.md` — для active queue.
- Если future idea не нужна для следующих двух фаз, не добавлять её в roadmap или оставить одной короткой заметкой.
