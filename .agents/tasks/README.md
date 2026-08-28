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
- Phase 11 (Character Engine v2): `in_progress` (гейт ревью)
  - `P11-A01` (Architectural Contracts & Layer Boundaries): `done`
  - `P11-T01` (Domain Models, Presets & Emotional Synthesis): `done`
  - `P11-T02` (Needs Metabolism, Plasticity & Stimuli Reducer): `done`
  - `P11-T03` (Unit Tests for Character Engine v2): `done`
  - `P11-T04` (Application Character State & Dialogue Integration): `done`
- Текущая активная задача: `P11-G01` (Code Review Phase 11).

## Активная очередь (Phase 11 — Character Engine v2)

### P11-T04 — Application Character State & Dialogue Integration

- **Статус:** `done`
- **Исполнитель:** `app-developer`
- **Зависит от:** `P11-T02`, `P11-T03`
- **Цель:** Связать доменный Character Engine с `dialogue-loop.service.ts` через in-memory character state сервис, заменив моковые данные `CharacterSnapshot` на актуальные доменные структуры.
- **Читать:** `docs/engine/CHARACTER_ENGINE.md`, `src/domain/character/`, `src/application/services/dialogue-loop.service.ts`.
- **Менять:** `src/application/services/` (`character-state.service.ts`, `dialogue-loop.service.ts`, `index.ts`), unit-тесты.
- **Критерии приёмки:**
  - [x] In-memory сервис хранит `CharacterState` и обновляет его по тикам/событиям через доменные функции.
  - [x] `processDialogueTurn` формирует реальный `CharacterSnapshot` через `createCharacterSnapshot`.
  - [x] `npm test` и `npm run typecheck` зелёные.
- **Вне скоупа:** Персистентность в SQLite (это Phase 14).

### P11-G01 — Code Review Phase 11

- **Статус:** `in_progress`
- **Исполнитель:** `reviewer`
- **Зависит от:** `P11-T04`
- **Цель:** Независимый аудит чистоты слоёв, отсутствия утечек инфраструктуры в домен, offline-first принципов и корректности интеграции Character Engine v2.
- **Читать:** `docs/engine/CHARACTER_ENGINE.md`, `src/domain/character/`, `src/application/services/character-state.service.ts`, `src/application/services/dialogue-loop.service.ts`.
- **Менять:** ничего (read-only аудит).
- **Критерии приёмки:**
  - [ ] Подтверждение соблюдения архитектурных границ (Domain не зависит от Node/Electron/UI/DB).
  - [ ] Подтверждение соблюдения принципов offline-first (нет сетевых вызовов, SDK сторонних провайдеров).
  - [ ] Подтверждение корректности интеграции в Application слой и валидности формул синтеза тона/метаболизма.
  - [ ] Отсутствие регрессий в тестовом покрытии (`npm test`, `npm run typecheck`).
- **Вне скоупа:** Исправление кода в том же проходе, добавление новых фичей.

## Поздние фазы

| Фаза | Тема | Исполнитель по умолчанию |
|---|---|---|
| 12 | Animation & Reaction Pack: richer reactions, idle variety, sleep/wake rules | `domain-behavior` |
| 13 | Render Engine & Asset Pipeline: sprite sheets, layers, props, themes | `app-developer` |
| 14 | Offline Memory & Relationship: SQLite memory, facts, history, clear memory | `app-developer` |
| 15 | Desktop Life Behaviors: quiet mode, cooldowns, habits | `domain-behavior` |
| 16 | Settings & Control Surface: behavior, appearance, memory controls, debug UI | `app-developer` |
| 17 | External AI Contract Readiness: future client-side adapter only | `architect` + `app-developer` |
| 18 | Stability & Performance Hardening: long sessions, cleanup, Wayland/X11 | `reviewer` |
| 19 | Production Packaging: Linux first, then Windows/macOS | `app-developer` |
