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

- Phase 0–9: `done` — архитектурная база, оверлей, FSM, UI, контракты ядра.
- Phase 10: `done` — Mock AI dialogue loop, client integration, scenarios & code review.
- Phase 11 (Character Engine v2): `in_progress` — потребности, отношения, пластичность, синтез эмоций.
  - `P11-A01` (Architectural Contracts & Layer Boundaries): `done`
  - `P11-T01` (Domain Models, Presets & Emotional Synthesis): `done`
- Текущая активная задача: `P11-T02` (Needs Metabolism & Stimuli Reducer).

## Активная очередь (Phase 11 — Character Engine v2)

### P11-T02 — Needs Metabolism & Stimuli Reducer

- **Статус:** `ready`
- **Исполнитель:** `domain-behavior`
- **Зависит от:** `P11-T01`
- **Цель:** Реализовать метаболизм потребностей по тикам времени (soft decay) и чистый редьюсер входящих стимулов с эволюцией `friendship` и гейтингом `loveUnlocked` ("no guilt" principle).
- **Читать:** `docs/engine/CHARACTER_ENGINE.md`, `docs/engine/BEHAVIOR_INTENTS.md`, `src/domain/character/types.ts`.
- **Менять:** `src/domain/character/` (создать `metabolism.ts`, `stimuli-reducer.ts`, обновить `index.ts`).
- **Критерии приёмки:**
  - [ ] Чистые функции тика метаболизма `metabolizeNeeds(needs, deltaMs, tone)` с soft decay.
  - [ ] Чистый редьюсер стимулов `processStimulus(state, event)` (petting, click, message, idle).
  - [ ] Прогрессия отношений: рост дружбы, разблокировка `loveUnlocked` при `friendship >= 400`, отсутствие штрафов за отсутствие пользователя.
  - [ ] `npm test` и `npm run typecheck` зелёные.
- **Вне скоупа:** React хуки, таймеры UI, SQLite.

### P11-T03 — Unit Tests for Character Engine v2

- **Статус:** `planned`
- **Исполнитель:** `tester`
- **Зависит от:** `P11-T02`
- **Цель:** Написать полный набор Vitest тестов для Character Engine v2 (Metabolism, Shyness, Emotional tone, Intimacy gating, Stimuli reducer).
- **Читать:** `docs/engine/CHARACTER_ENGINE.md`.
- **Менять:** `tests/domain/character-engine.test.ts`.
- **Критерии приёмки:** 100% покрытие всех веток логики характера, `npm test` зелёный.
- **Вне скоупа:** UI тесты.

### P11-G01 — Code Review Phase 11

- **Статус:** `planned`
- **Исполнитель:** `code-reviewer`
- **Зависит от:** `P11-T03`
- **Цель:** Независимый аудит чистоты domain layer и отсутствия утечек инфраструктуры/UI.
- **Читать:** изменённые файлы Phase 11 и `docs/engine/CHARACTER_ENGINE.md`.
- **Менять:** ничего.
- **Критерии приёмки:** подтверждение соблюдения архитектурных границ и offline-first.
- **Вне скоупа:** новые фичи.

## Поздние фазы

| Фаза | Тема | Исполнитель по умолчанию |
|---|---|---|
| 12 | Animation & Reaction Pack: richer reactions, idle variety, sleep/wake rules | `domain-behavior` |
| 13 | Render Engine & Asset Pipeline: sprite sheets, layers, props, themes | `ui-specialist` |
| 14 | Offline Memory & Relationship: SQLite memory, facts, history, clear memory | `data-memory` |
| 15 | Desktop Life Behaviors: quiet mode, cooldowns, habits | `domain-behavior` |
| 16 | Settings & Control Surface: behavior, appearance, memory controls, debug UI | `ui-specialist` |
| 17 | External AI Contract Readiness: future client-side adapter only | `architect` + `mock-ai-provider` |
| 18 | Stability & Performance Hardening: long sessions, cleanup, Wayland/X11 | `tester` |
| 19 | Production Packaging: Linux first, then Windows/macOS | `electron-platform` |
