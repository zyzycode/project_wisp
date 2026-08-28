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
  - `P12-T02` (Idle Variety & Sleep/Wake Autonomous Life Rules): `in_progress`
  - `P12-T03` (Unit Tests for Animation & Reaction Pack): `planned`
  - `P12-G01` (Code Review Phase 12): `planned`

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
- **Цель:** Реализовать доменную модель `AnimationIntent`, типы `AnimationExpressionHint`/`AnimationPropHint`, чистый маппер `mapBehaviorIntentToAnimationIntent` и расширить FSM с поддержкой приоритетов и состояний (`spook`, `sleep_start`, `sleep_loop`, `wake_up`, `settle`).
- **Читать:** `.agents/agents/domain-behavior/agent.md`, `docs/engine/ANIMATION_ENGINE.md`, `src/domain/animation/`.
- **Менять:** `src/domain/animation/` (`animation-intent.ts`, `animation-state-machine.ts`, `index.ts`), unit-тесты.
- **Критерии приёмки:**
  - [x] Типы `AnimationIntent`, `AnimationIntentKind`, `AnimationPriority`, `AnimationExpressionHint`, `AnimationPropHint` соответствуют контракту.
  - [x] Чистый маппер реализует сводную матрицу переходов с учётом 7 тонов `SynthesizedEmotionalTone`.
  - [x] `AnimationStateMachine` поддерживает новые состояния, приоритеты и не-прерываемые циклы.
  - [x] `npm test` и `npm run typecheck` зелёные.
- **Вне скоупа:** Рендеринг и UI.

### P12-T02 — Idle Variety & Sleep/Wake Autonomous Life Rules

- **Статус:** `in_progress`
- **Исполнитель:** `domain-behavior`
- **Зависит от:** `P12-T01`
- **Цель:** Реализовать витальные автономные правила засыпания и пробуждения на основе `Needs` (засыпание при `energy <= 20` или `comfort >= 80`, пробуждение при `attention >= 90` или восстановлении `energy >= 80`) и вариативность idle-поведения с учётом тона и пауз.
- **Читать:** `.agents/agents/domain-behavior/agent.md`, `docs/engine/ANIMATION_ENGINE.md`, `docs/engine/CHARACTER_ENGINE.md`, `src/domain/behavior/`.
- **Менять:** `src/domain/behavior/` (`autonomous-behavior.ts`, `idle-variety.ts` [создать/обновить]), unit-тесты.
- **Критерии приёмки:**
  - [ ] Автономный генератор намерений корректно генерирует `sleep`/`wake` на основе порогов `Needs`.
  - [ ] Idle-вариативность генерирует микродействия без спама и не прерывает `sleep_loop`.
  - [ ] `npm test` и `npm run typecheck` зелёные.
- **Вне скоупа:** UI-компоненты.

### P12-T03 — Unit Tests for Animation & Reaction Pack

- **Статус:** `planned`
- **Исполнитель:** `domain-behavior`
- **Зависит от:** `P12-T02`
- **Цель:** Комплексные тесты маппинга, приоритетов прерываний и удержания сна.
- **Читать:** `.agents/agents/domain-behavior/agent.md`, `docs/engine/ANIMATION_ENGINE.md`, `tests/domain/`.
- **Менять:** `tests/domain/` (`animation-engine.test.ts`, `autonomous-behavior.test.ts`).
- **Критерии приёмки:**
  - [ ] 100% покрытие сценариев маппинга и правил прерывания.
  - [ ] `npm test` и `npm run typecheck` зелёные.
- **Вне скоупа:** UI-тесты.

### P12-G01 — Code Review Phase 12

- **Статус:** `planned`
- **Исполнитель:** `reviewer`
- **Зависит от:** `P12-T03`
- **Цель:** Аудит чистоты слоёв и соответствия контракту `ANIMATION_ENGINE.md`.
- **Читать:** `.agents/agents/reviewer/agent.md`, `docs/engine/ANIMATION_ENGINE.md`, код Phase 12.
- **Менять:** ничего.
- **Критерии приёмки:**
  - [ ] Подтверждена изоляция Domain Layer и контрактов.
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
