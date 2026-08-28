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
- Текущая активная задача: `P11-T02` (Needs Metabolism, Plasticity & Stimuli Reducer).

## Активная очередь (Phase 11 — Character Engine v2)

### P11-T02 — Needs Metabolism, Plasticity & Stimuli Reducer

- **Статус:** `in_progress`
- **Исполнитель:** `domain-behavior`
- **Зависит от:** `P11-T01`
- **Цель:** Реализовать чистые функции метаболизма потребностей (`metabolizeNeeds`), адаптации осей личности с учётом коридоров и пластичности (`adaptPersonalityAxes`), трекинга вкусов/предпочтений (`trackPreference`) и редуктора стимулов (`processStimulus`).
- **Читать:** `docs/engine/CHARACTER_ENGINE.md`, `docs/engine/BEHAVIOR_INTENTS.md`, `src/domain/character/types.ts`.
- **Менять:** `src/domain/character/` (создать `metabolism.ts`, `personality-plasticity.ts`, `preferences.ts`, `stimuli-reducer.ts`, обновить `index.ts`).
- **Критерии приёмки:**
  - [ ] Чистая функция `metabolizeNeeds(needs, deltaMs, tone)` с мягким затуханием (soft decay) без чувства вины.
  - [ ] Чистый редъюсер `processStimulus(state, stimulus)` для событий: `click`, `pet`, `chat_message`, `idle_tick`, `topic_dialogue`.
  - [ ] Прогрессия отношений: рост `friendship`, разблокировка `loveUnlocked` при `friendship >= 400`, отсутствие штрафов за отсутствие.
  - [ ] Дрейф осей личности в коридорах `[hardMin, hardMax]` и сопротивлением вне `[softMin, softMax]` с весом `plasticity`.
  - [ ] Эволюция предпочтений `PreferenceTrack` (накопление `samples`, расчёт `confidence` и смещение `value`).
  - [ ] `npm test` и `npm run typecheck` зелёные.
- **Вне скоупа:** React-хуки, таймеры UI, SQLite.

### P11-T03 — Unit Tests for Character Engine v2

- **Статус:** `planned`
- **Исполнитель:** `domain-behavior`
- **Зависит от:** `P11-T02`
- **Цель:** Написать полный набор Vitest тестов для всех доменных модулей Character Engine v2 (Metabolism, Plasticity, Shyness, Emotional Tone, Intimacy gating, Preferences, Stimuli Reducer).
- **Читать:** `docs/engine/CHARACTER_ENGINE.md`, `src/domain/character/`.
- **Менять:** `tests/domain/character-engine.test.ts`.
- **Критерии приёмки:**
  - [ ] 100% покрытие всех веток логики характера, потребностей, флирта и пластичности.
  - [ ] `npm test` зелёный.
- **Вне скоупа:** UI и IPC тесты.

### P11-T04 — Application Character State & Dialogue Integration

- **Статус:** `planned`
- **Исполнитель:** `app-developer`
- **Зависит от:** `P11-T03`
- **Цель:** Связать доменный Character Engine с `dialogue-loop.service.ts` через in-memory character state сервис, заменив моковые данные `CharacterSnapshot` на актуальные доменные структуры.
- **Читать:** `docs/engine/CHARACTER_ENGINE.md`, `src/application/services/dialogue-loop.service.ts`.
- **Менять:** `src/application/services/` (создать `character-state.service.ts`, обновить `dialogue-loop.service.ts`).
- **Критерии приёмки:**
  - [ ] In-memory сервис хранит `CharacterState` и обновляет его по тикам/событиям через доменные функции.
  - [ ] `processDialogueTurn` формирует реальный `CharacterSnapshot` через `createCharacterSnapshot`.
  - [ ] `npm test` и `npm run typecheck` зелёные.
- **Вне скоупа:** Персистентность в SQLite (это Phase 14).

### P11-G01 — Code Review Phase 11

- **Статус:** `planned`
- **Исполнитель:** `reviewer`
- **Зависит от:** `P11-T04`
- **Цель:** Независимый аудит чистоты слоёв, отсутствия утечек инфраструктуры в домен и корректности интеграции.
- **Читать:** изменённые файлы Phase 11 и `docs/engine/CHARACTER_ENGINE.md`.
- **Менять:** ничего.
- **Критерии приёмки:**
  - [ ] Подтверждение соблюдения архитектурных границ и offline-first.
  - [ ] Подтверждение корректности интеграции в Application слой.
- **Вне скоупа:** новые фичи.

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
