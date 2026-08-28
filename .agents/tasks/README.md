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

- Phase 0–13: `done` — архитектура, оверлей, FSM, Character Engine v2, AI dialogue loop, Animation & Reaction Pack, Render Engine, Sprites, Logger & Debug HUD.
- Phase 14 (Offline Memory & Relationship Persistence): `in_progress`
  - `P14-A01` (Architecture Contract: MEMORY_ENGINE.md): `ready`
  - `P14-T01` (SQLite Database Initialization & Migrations): `planned`
  - `P14-T02` (Chat History Repository & Bounded Context Buffer): `planned`
  - `P14-T03` (User Facts & Character State Persistence): `planned`
  - `P14-T04` (Privacy Controls & Clear Memory Flow): `planned`
  - `P14-T05` (Integration Tests for Memory Engine): `planned`
  - `P14-G01` (Code Review Phase 14): `planned`

## Активная очередь (Phase 14 — Offline Memory & Relationship Persistence)

### P14-A01 — Architecture Contract: MEMORY_ENGINE.md

- **Статус:** `ready`
- **Исполнитель:** `architect`
- **Зависит от:** none
- **Цель:** Создать и специфицировать архитектурный контракт `docs/engine/MEMORY_ENGINE.md`: схему таблиц SQLite (диалоги, извлечённые факты о пользователе, состояние Relationship/Needs/Personality), порты репозиториев (`IChatHistoryRepository`, `IUserFactsRepository`, `ICharacterStateRepository`), DTO, лимиты контекста (FIFO буфер реплик), offline-first границы, приватность и обязательный контракт полного сброса памяти (`clear memory`).
- **Читать:** `.agents/agents/architect/agent.md`, `docs/engine/CHARACTER_ENGINE.md`, `docs/engine/AI_PROVIDER_CONTRACT.md`.
- **Менять:** `docs/engine/MEMORY_ENGINE.md` (создать), `docs/engine/README.md`.
- **Критерии приёмки:**
  - [ ] Описана схема таблиц SQLite (`messages`, `user_facts`, `character_state`, `schema_migrations`).
  - [ ] Специфицированы интерфейсы портов в Application layer.
  - [ ] Определена политика ограничения истории (bounded context buffer для Mock AI).
  - [ ] Описан контракт безопасного удаления данных пользователя (Clear Memory).
  - [ ] Сохранены строгие границы Clean Architecture (никаких прямых SQL-запросов из UI или Domain).

### P14-T01 — SQLite Database Initialization & Migrations

- **Статус:** `planned`
- **Исполнитель:** `app-developer`
- **Зависит от:** `P14-A01`
- **Цель:** Инициализация локальной базы SQLite (better-sqlite3 / sqlite3) в каталоге пользовательских данных Electron (`app.getPath('userData')`), система запуска миграций и транзакций.
- **Читать:** `.agents/agents/app-developer/agent.md`, `docs/engine/MEMORY_ENGINE.md`.
- **Менять:** `src/infrastructure/persistence/` (`database.ts`, `migrations/`, `index.ts`), unit-тесты.
- **Критерии приёмки:**
  - [ ] База создаётся в изолированной директории пользователя.
  - [ ] Миграции накатываются идемпотентно.
  - [ ] `npm test` и `npm run typecheck` зелёные.

### P14-T02 — Chat History Repository & Bounded Context Buffer

- **Статус:** `planned`
- **Исполнитель:** `app-developer`
- **Зависит от:** `P14-T01`
- **Цель:** Реализация порта `IChatHistoryRepository`: сохранение сообщений пользователя и Wisp, выборка последних N реплик с ограничением токенов/символов для контекста AI.
- **Читать:** `.agents/agents/app-developer/agent.md`, `docs/engine/MEMORY_ENGINE.md`.
- **Менять:** `src/infrastructure/persistence/chat-history.repository.ts`, unit-тесты.
- **Критерии приёмки:**
  - [ ] Сообщения сохраняются и быстро запрашиваются с пагинацией/лимитом.
  - [ ] `npm test` и `npm run typecheck` зелёные.

### P14-T03 — User Facts & Character State Persistence

- **Статус:** `planned`
- **Исполнитель:** `app-developer`
- **Зависит от:** `P14-T01`
- **Цель:** Сохранение состояния потребностей (`Needs`), уровня дружбы/любви (`Relationship`) и извлечённых фактов о пользователе (имя, предпочтения) между перезапусками приложения.
- **Читать:** `.agents/agents/app-developer/agent.md`, `docs/engine/MEMORY_ENGINE.md`.
- **Менять:** `src/infrastructure/persistence/repositories/`, unit-тесты.
- **Критерии приёмки:**
  - [ ] При перезапуске приложения прогресс отношений и витальные потребности восстанавливаются.
  - [ ] `npm test` и `npm run typecheck` зелёные.

### P14-T04 — Privacy Controls & Clear Memory Flow

- **Статус:** `planned`
- **Исполнитель:** `app-developer`
- **Зависит от:** `P14-T02`, `P14-T03`
- **Цель:** Реализация Use Case `ClearMemoryUseCase` и IPC-метода очистки данных: сброс фактов, истории и отношений по требованию пользователя.
- **Читать:** `.agents/agents/app-developer/agent.md`, `docs/engine/MEMORY_ENGINE.md`.
- **Менять:** `src/application/use-cases/`, IPC-обработчики, unit-тесты.
- **Критерии приёмки:**
  - [ ] Полная атомарная очистка памяти без поломки работы запущенного Wisp.
  - [ ] `npm test` и `npm run typecheck` зелёные.

## Поздние фазы

| Фаза | Тема | Исполнитель по умолчанию |
|---|---|---|
| 15 | Desktop Life Behaviors: quiet mode, cooldowns, habits | `domain-behavior` |
| 16 | Settings & Control Surface: behavior, appearance, memory controls, full debug panel | `app-developer` |
| 17 | External AI Contract Readiness: future client-side adapter only | `architect` + `app-developer` |
| 18 | Stability & Performance Hardening: long sessions, cleanup, Wayland/X11 | `reviewer` |
| 19 | Production Packaging: Linux first, then Windows/macOS | `app-developer` |
