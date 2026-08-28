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

- Phase 0–11: `done` — архитектура, оверлей, FSM, Character Engine v2, AI dialogue loop.
- Phase 12 (Animation & Reaction Pack): `in_progress`
  - `P12-A01` (Architecture Sync: Animation Engine & Character Engine v2): `done`
  - `P12-T01` (Domain Animation Engine & Intent Mapping): `done`
  - `P12-T02` (Idle Variety & Sleep/Wake Autonomous Life Rules): `done`
  - `P12-T03` (Unit Tests for Animation & Reaction Pack): `done`
  - `P12-G01` (Code Review Phase 12): `in_progress`

## Активная очередь (Phase 12 — Animation & Reaction Pack)

### P12-A01 — Architecture Sync: Animation Engine & Character Engine v2

- **Статус:** `done`
- **Исполнитель:** `architect`
- **Зависит от:** none
- **Цель:** Синхронизировать `docs/engine/ANIMATION_ENGINE.md` с Character Engine v2.
- **Читать:** `.agents/agents/architect/agent.md`, `docs/engine/CHARACTER_ENGINE.md`, `docs/engine/ANIMATION_ENGINE.md`.
- **Менять:** `docs/engine/ANIMATION_ENGINE.md`.
- **Критерии приёмки:**
  - [x] Маппинг всех тонов `SynthesizedEmotionalTone` в `AnimationIntent`.
  - [x] Спецификация `propHint` и подсказок выражений (`blush`, `heart`, `question`, `pillow`).
  - [x] Политика graceful degradation (fallback).
- **Вне скоупа:** Написание TS-кода.

### P12-T01 — Domain Animation Engine & Intent Mapping

- **Статус:** `done`
- **Исполнитель:** `domain-behavior`
- **Зависит от:** `P12-A01`
- **Цель:** Реализовать доменную модель `AnimationIntent`, типы, чистый маппер и расширенную FSM.
- **Читать:** `.agents/agents/domain-behavior/agent.md`, `docs/engine/ANIMATION_ENGINE.md`, `src/domain/animation/`.
- **Менять:** `src/domain/animation/` (`animation-intent.ts`, `animation-state-machine.ts`, `index.ts`), unit-тесты.
- **Критерии приёмки:**
  - [x] Типы и чистый маппер соответствуют контракту.
  - [x] `AnimationStateMachine` поддерживает новые состояния, приоритеты и не-прерываемые циклы.
  - [x] `npm test` и `npm run typecheck` зелёные.
- **Вне скоупа:** Рендеринг и UI.

### P12-T02 — Idle Variety & Sleep/Wake Autonomous Life Rules

- **Статус:** `done`
- **Исполнитель:** `domain-behavior`
- **Зависит от:** `P12-T01`
- **Цель:** Реализовать витальные автономные правила сна/пробуждения по `Needs` и вариативность idle.
- **Читать:** `.agents/agents/domain-behavior/agent.md`, `docs/engine/ANIMATION_ENGINE.md`, `src/domain/behavior/`.
- **Менять:** `src/domain/behavior/` (`autonomous-behavior.ts`, `idle-variety.ts`), unit-тесты.
- **Критерии приёмки:**
  - [x] Автономные правила сна/пробуждения и idle-микроанимации.
  - [x] `npm test` и `npm run typecheck` зелёные.
- **Вне скоупа:** UI-компоненты.

### P12-T03 — Unit Tests for Animation & Reaction Pack

- **Статус:** `done`
- **Исполнитель:** `domain-behavior`
- **Зависит от:** `P12-T02`
- **Цель:** Написать сквозные интеграционные unit-тесты для Phase 12.
- **Читать:** `.agents/agents/domain-behavior/agent.md`, `docs/engine/ANIMATION_ENGINE.md`, `tests/domain/`.
- **Менять:** `tests/domain/animation-reaction-pack.test.ts`.
- **Критерии приёмки:**
  - [x] 100% покрытие сквозных цепочек взаимодействия (Needs -> BehaviorIntent -> AnimationIntent -> FSM).
  - [x] `npm test` и `npm run typecheck` завершаются без ошибок.
- **Вне скоупа:** UI-тесты.

### P12-G01 — Code Review Phase 12

- **Статус:** `in_progress`
- **Исполнитель:** `reviewer`
- **Зависит от:** `P12-T03`
- **Цель:** Финальный архитектурный аудит всей Phase 12 перед переходом к Phase 13 (Render Engine).
- **Читать:** `.agents/agents/reviewer/agent.md`, `docs/engine/ANIMATION_ENGINE.md`, весь код Phase 12 (`src/domain/animation/`, `src/domain/behavior/`, `tests/domain/`).
- **Менять:** ничего.
- **Критерии приёмки:**
  - [ ] Подтверждена строгая изоляция Domain Layer (отсутствие зависимостей от React, Electron, DOM).
  - [ ] Подтверждено полное соответствие контракту `docs/engine/ANIMATION_ENGINE.md`.
  - [ ] Все тесты фазы зелёные.
- **Вне скоупа:** Правки кода.

## Поздние фазы

| Фаза | Тема | Исполнитель по умолчанию |
|---|---|---|
| 13 | Render Engine, Sprite Pipeline, Logger & Mini-Debug HUD | `app-developer` |
| 14 | Offline Memory & Relationship: SQLite memory, facts, history, clear memory | `app-developer` |
| 15 | Desktop Life Behaviors: quiet mode, cooldowns, habits | `domain-behavior` |
| 16 | Settings & Control Surface: behavior, appearance, memory controls, full debug panel | `app-developer` |
| 17 | External AI Contract Readiness: future client-side adapter only | `architect` + `app-developer` |
| 18 | Stability & Performance Hardening: long sessions, cleanup, Wayland/X11 | `reviewer` |
| 19 | Production Packaging: Linux first, then Windows/macOS | `app-developer` |
