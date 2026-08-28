# .agents/tasks/README.md — компактная доска задач Project Wisp

Этот файл хранит только ближайший рабочий фронт и правила передачи задач агентам.
`ROADMAP.md` отвечает на вопрос: куда идём.
Этот файл отвечает на вопрос: что делать следующим.

## Бюджет контекста

- Держать файл коротким: целевой размер — до 180 строк.
- Активными держать только текущую фазу и 3–5 задач.
- Агенту в prompt передаётся одна карточка задачи, а не весь backlog.
- Агент читает только релевантный `docs/engine/*.md`.

## Статусы

- `planned` — задача понятна, но ещё не готова к выдаче.
- `ready` — можно выдавать owner-agent.
- `in_progress` — задача выполняется.
- `blocked` — нужен внешний ответ или решение.
- `done` — результат принят.

## Текущее состояние

- Phase 0–12: `done` — архитектура, оверлей, FSM, Character Engine v2, AI dialogue loop, Animation & Reaction Pack.
- Phase 13 (Render Engine & Asset Pipeline): `in_progress`
  - `P13-A01` (Architecture Contract: RENDER_ENGINE.md): `in_progress`
  - `P13-T01` (Structured Logger Infrastructure & Telemetry Stream): `planned`
  - `P13-T02` (Asset Manifest Parser & Sprite Playback Controller): `planned`
  - `P13-T03` (Layered Character Renderer Component): `planned`
  - `P13-T04` (Safe Fallback Implementation): `planned`
  - `P13-T05` (Mini-Debug HUD & Dev Overlay): `planned`
  - `P13-T06` (Unit & Component Tests for Render Engine): `planned`
  - `P13-G01` (Code Review Phase 13): `planned`

## Активная очередь (Phase 13 — Render Engine & Asset Pipeline)

### P13-A01 — Architecture Contract: RENDER_ENGINE.md

- **Статус:** `in_progress`
- **Исполнитель:** `architect`
- **Зависит от:** none
- **Цель:** Создать и специфицировать архитектурный контракт `docs/engine/RENDER_ENGINE.md`: форматы спрайт-листов, схема `manifest.json`, правила нарезки и воспроизведения кадров, иерархия слоёв (базовое тело + мимика + процедурный румянец + пропсы), спецификация контракта логгера `ILogger` и 3-уровневый алгоритм Graceful Fallback.
- **Читать:** `.agents/agents/architect/agent.md`, `docs/engine/ANIMATION_ENGINE.md`, `docs/engine/CHARACTER_ENGINE.md`, `public/assets/sprites/manifest.json`.
- **Менять:** `docs/engine/RENDER_ENGINE.md` (создать).
- **Критерии приёмки:**
  - [ ] Специфицирован формат `manifest.json` и структура описания спрайт-анимаций.
  - [ ] Описана композиция слоёв: `body` -> `face` -> `blush` -> `props` (`pillow`, `heart`, `question`, `sparkle`).
  - [ ] Формализован контракт интерфейса `ILogger` с уровнями и контекстами.
  - [ ] Чётко описан алгоритм 3-уровневого Graceful Fallback при отсутствии конкретных кадров.
  - [ ] Сохранены строгие границы слоёв (контракт не зависит от деталей сборщика Vite или React-хуков).
- **Вне скоупа:** Написание TS-кода или компонентов.

### P13-T01 — Structured Logger Infrastructure & Telemetry Stream

- **Статус:** `planned`
- **Исполнитель:** `app-developer`
- **Зависит от:** `P13-A01`
- **Цель:** Реализовать порт `ILogger`, адаптер структурированного логирования с фильтрацией по модулям, глобальным выключением и кольцевым буфером в памяти.
- **Читать:** `.agents/agents/app-developer/agent.md`, `docs/engine/RENDER_ENGINE.md`.
- **Менять:** `src/application/ports/logger.interface.ts`, `src/infrastructure/logging/`.
- **Критерии приёмки:**
  - [ ] Реализован интерфейс `ILogger` и адаптер `AppLogger`.
  - [ ] Поддерживаются уровни `debug`, `info`, `warn`, `error`, `silent` и кольцевой буфер.
  - [ ] `npm test` и `npm run typecheck` зелёные.

### P13-T02 — Asset Manifest Parser & Sprite Playback Controller

- **Статус:** `planned`
- **Исполнитель:** `app-developer`
- **Зависит от:** `P13-A01`
- **Цель:** Загрузка и валидация `manifest.json`, кэширование спрайтов, контроллер покадрового воспроизведения под готовые 4 спрайта `body_walk_00..03.png`.
- **Читать:** `.agents/agents/app-developer/agent.md`, `docs/engine/RENDER_ENGINE.md`, `public/assets/sprites/`.
- **Менять:** `src/renderer/render-engine/` (`manifest-loader.ts`, `playback-controller.ts`), unit-тесты.
- **Критерии приёмки:**
  - [ ] Загрузка спрайтов и вычисление кадров по таймингам.
  - [ ] `npm test` и `npm run typecheck` зелёные.

### P13-T03 — Layered Character Renderer Component

- **Статус:** `planned`
- **Исполнитель:** `app-developer`
- **Зависит от:** `P13-T02`
- **Цель:** React-компонент многослойного рендеринга Wisp (тело + процедурный румянец + визуальные оверлеи пропсов).
- **Читать:** `.agents/agents/app-developer/agent.md`, `docs/engine/RENDER_ENGINE.md`, `src/renderer/components/`.
- **Менять:** `src/renderer/components/Character/` (`SpriteRenderer.tsx`, `CharacterRenderer.tsx`), CSS/компоненты.
- **Критерии приёмки:**
  - [ ] Wisp рендерится через спрайты с оверлеями румянца и пропсов.
  - [ ] `npm test` и `npm run typecheck` зелёные.

### P13-T04 — Safe Fallback Implementation

- **Статус:** `planned`
- **Исполнитель:** `app-developer`
- **Зависит от:** `P13-T03`
- **Цель:** Автоматический безопасный откат при отсутствии покадровых спрайтов (Level 1 -> Level 2 -> Level 3).
- **Читать:** `.agents/agents/app-developer/agent.md`, `docs/engine/RENDER_ENGINE.md`.
- **Менять:** `src/renderer/render-engine/fallback-controller.ts`, unit-тесты.
- **Критерии приёмки:**
  - [ ] Никакие отсутствующие спрайты не вызывают ошибок или зависаний.
  - [ ] `npm test` и `npm run typecheck` зелёные.

### P13-T05 — Mini-Debug HUD & Dev Overlay

- **Статус:** `planned`
- **Исполнитель:** `app-developer`
- **Зависит от:** `P13-T01`, `P13-T03`
- **Цель:** Оверлей отладки (`Ctrl+D` / контекстное меню) с выводом live-потребностей, дружбы, тона, FPS и ленты логов.
- **Читать:** `.agents/agents/app-developer/agent.md`, `docs/engine/RENDER_ENGINE.md`, `src/renderer/components/`.
- **Менять:** `src/renderer/components/Debug/` (`DebugHUD.tsx`, `LogViewer.tsx`).
- **Критерии приёмки:**
  - [ ] Оверлей открывается по хоткею и меню, показывает живые данные.
  - [ ] `npm test` и `npm run typecheck` зелёные.

### P13-T06 — Unit & Component Tests for Render Engine

- **Статус:** `planned`
- **Исполнитель:** `app-developer`
- **Зависит от:** `P13-T04`, `P13-T05`
- **Цель:** Полное тестовое покрытие пайплайна спрайтов, логгера, фоллбеков и компонентов.
- **Читать:** `.agents/agents/app-developer/agent.md`, `docs/engine/RENDER_ENGINE.md`, `tests/renderer/`.
- **Менять:** `tests/renderer/`.
- **Критерии приёмки:**
  - [ ] 100% зелёные тесты.

### P13-G01 — Code Review Phase 13

- **Статус:** `planned`
- **Исполнитель:** `reviewer`
- **Зависит от:** `P13-T06`
- **Цель:** Аудит Phase 13.
- **Читать:** `.agents/agents/reviewer/agent.md`, `docs/engine/RENDER_ENGINE.md`, код Phase 13.
- **Менять:** ничего.

## Поздние фазы

| Фаза | Тема | Исполнитель по умолчанию |
|---|---|---|
| 14 | Offline Memory & Relationship: SQLite memory, facts, history, clear memory | `app-developer` |
| 15 | Desktop Life Behaviors: quiet mode, cooldowns, habits | `domain-behavior` |
| 16 | Settings & Control Surface: behavior, appearance, memory controls, full debug panel | `app-developer` |
| 17 | External AI Contract Readiness: future client-side adapter only | `architect` + `app-developer` |
| 18 | Stability & Performance Hardening: long sessions, cleanup, Wayland/X11 | `reviewer` |
| 19 | Production Packaging: Linux first, then Windows/macOS | `app-developer` |
