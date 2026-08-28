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
| 12 — Animation & Reaction Pack | in_progress | `architect` + `domain-behavior` | Синхронизация контракта с Character Engine v2, реакции, idle variety, sleep rules. |
| 13 — Render Engine & Asset Pipeline | next | `architect` + `app-developer` | Спецификация RENDER_ENGINE.md, спрайт-пайплайн, слои (пропсы/румянец), fallback. |
| 14 — Offline Memory & Relationship | later | `app-developer` | SQLite memory, bounded history, local fact extraction и clear memory. |
| 15 — Desktop Life Behaviors | later | `domain-behavior` | Quiet mode, cooldowns, habits и менее навязчивая автономность. |
| 16 — Settings & Control Surface | later | `app-developer` | Behavior, appearance, memory controls и dev-only debug panel. |
| 17 — External AI Contract Readiness | future | `architect` + `app-developer` | Только client-side контракт будущего adapter; backend остаётся отдельно. |
| 18 — Stability & Performance Hardening | future | `reviewer` | Long-session stability, cleanup checks и Linux Wayland/X11 fallbacks. |
| 19 — Production Packaging | future | `app-developer` | Linux package baseline, затем готовность Windows/macOS release. |

## Заметки по ближайшим фазам

### Phase 12 — Animation & Reaction Pack (`in_progress`)
Синхронизация `ANIMATION_ENGINE.md` с Character Engine v2 (7 тонов, витальный сон/пробуждение), доменная модель `AnimationIntent`, расширенная стейт-машина и вариативность idle.

### Phase 13 — Render Engine & Asset Pipeline (`next`)
Оживление персонажа реальными спрайтами и визуальными эффектами:
1. **`P13-A01` (`architect`):** Фиксация контракта `docs/engine/RENDER_ENGINE.md` (спрайт-листы, `manifest.json`, pivot points, слои пропсов `propHint`, процедурный румянец, контракт 3-уровневого Graceful Fallback).
2. **`P13-T01` (`app-developer`):** Загрузчик спрайтов, парсер манифеста и покадровый playback-контроллер (подключение готовых 4 кадров `body/walk`).
3. **`P13-T02` (`app-developer`):** Многослойный рендерер персонажа (тело + оверлей мимики + пропсы сердечек/подушки/вопросиков).
4. **`P13-T03` (`app-developer`):** Graceful Fallback система (автоматический откат к базовому спрайту или векторной заглушке при отсутствии специализированного набора кадров).
5. **`P13-T04` (`app-developer`):** Unit и компонентные тесты рендерера.
6. **`P13-G01` (`reviewer`):** Аудит фазы 13.
