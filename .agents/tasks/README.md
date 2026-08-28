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
  - `P12-T01` (Domain Animation Engine & Intent Mapping): `in_progress`
  - `P12-T02` (Idle Variety & Sleep/Wake Autonomous Life Rules): `planned`
  - `P12-T03` (Unit Tests for Animation & Reaction Pack): `planned`
  - `P12-G01` (Code Review Phase 12): `planned`

## Активная очередь (Phase 12 — Animation & Reaction Pack)

### P12-T01 — Domain Animation Engine & Intent Mapping

- **Статус:** `in_progress`
- **Исполнитель:** `domain-behavior`
- **Зависит от:** none
- **Цель:** Реализовать domain-модель `AnimationIntent`, маппинг из `BehaviorIntent`, приоритеты и расширенные состояния FSM (`happy_reaction`, `confused_reaction`, `idle_blink`, `sleep_start`, `sleep_loop`, `wake_up`, `settle`) с поддержкой `propHint`.
- **Читать:** `docs/engine/ANIMATION_ENGINE.md`, `src/domain/animation/animation-state-machine.ts`, `src/domain/behavior/behavior-intent.ts`.
- **Менять:** `src/domain/animation/` (`animation-intent.ts`, `animation-state-machine.ts`, `index.ts`), unit-тесты.
- **Критерии приёмки:**
  - [ ] Реализованы типы `AnimationIntent`, `AnimationIntentKind`, `AnimationPriority` согласно контракту.
  - [ ] Реализован чистый доменный маппер `mapBehaviorIntentToAnimationIntent(behaviorIntent)`.
  - [ ] FSM поддерживает приоритеты, не-прерываемые состояния и авто-переход в `settle` / `idle_blink`.
  - [ ] Написаны unit-тесты на intent mapping и transitions.
  - [ ] `npm test` и `npm run typecheck` зелёные.
- **Вне скоупа:** Рендеринг спрайтов и SVG-ассетов (это Phase 13).

### P12-T02 — Idle Variety & Sleep/Wake Autonomous Life Rules

- **Статус:** `planned`
- **Исполнитель:** `domain-behavior`
- **Зависит от:** `P12-T01`
- **Цель:** Добавить в автономное поведение вариативность idle (micro-motions, осмотр, моргание), тайминги засыпания при низкой энергии/высоком комфорте и правила плавного пробуждения.
- **Читать:** `docs/engine/ANIMATION_ENGINE.md`, `docs/engine/CHARACTER_ENGINE.md`, `src/domain/behavior/autonomous-behavior.ts`.
- **Менять:** `src/domain/behavior/` (`autonomous-behavior.ts`, `idle-variety.ts`), unit-тесты.
- **Критерии приёмки:**
  - [ ] Автономный генератор намерений учитывает `Needs` (засыпание при низкой энергии).
  - [ ] Введены вариативные idle-действия без спама переходов.
  - [ ] `npm test` и `npm run typecheck` зелёные.
- **Вне скоупа:** UI-компоненты.

### P12-T03 — Unit Tests for Animation & Reaction Pack

- **Статус:** `planned`
- **Исполнитель:** `domain-behavior`
- **Зависит от:** `P12-T02`
- **Цель:** Комплексное покрытие тестами всех сценариев маппинга, прерывания критическими событиями (drag), удержания sleep-лупа и возврата в idle.
- **Читать:** `docs/engine/ANIMATION_ENGINE.md`, `tests/domain/`.
- **Менять:** `tests/domain/` (`animation-engine.test.ts`, `autonomous-behavior.test.ts`).
- **Критерии приёмки:**
  - [ ] Покрыты 100% сценариев обязательного маппинга из `ANIMATION_ENGINE.md`.
  - [ ] Покрыты правила приоритетов (critical drag прерывает любое состояние).
  - [ ] `npm test` и `npm run typecheck` проходят без ошибок.
- **Вне скоупа:** Интеграционные UI-тесты.

### P12-G01 — Code Review Phase 12

- **Статус:** `planned`
- **Исполнитель:** `reviewer`
- **Зависит от:** `P12-T03`
- **Цель:** Независимый аудит соблюдения контракта `ANIMATION_ENGINE.md` и чистоты доменного слоя.
- **Читать:** `docs/engine/ANIMATION_ENGINE.md`, `src/domain/animation/`, `src/domain/behavior/`.
- **Менять:** ничего.
- **Критерии приёмки:**
  - [ ] Подтверждена изоляция Domain Layer.
  - [ ] Подтверждено соответствие контракту анимаций.
- **Вне скоупа:** Правки кода.

## Поздние фазы

| Фаза | Тема | Исполнитель по умолчанию |
|---|---|---|
| 13 | Render Engine & Asset Pipeline: sprite sheets, layers, props, themes | `app-developer` |
| 14 | Offline Memory & Relationship: SQLite memory, facts, history, clear memory | `app-developer` |
| 15 | Desktop Life Behaviors: quiet mode, cooldowns, habits | `domain-behavior` |
| 16 | Settings & Control Surface: behavior, appearance, memory controls, debug UI | `app-developer` |
| 17 | External AI Contract Readiness: future client-side adapter only | `architect` + `app-developer` |
| 18 | Stability & Performance Hardening: long sessions, cleanup, Wayland/X11 | `reviewer` |
| 19 | Production Packaging: Linux first, then Windows/macOS | `app-developer` |
