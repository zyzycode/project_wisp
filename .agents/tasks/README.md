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
  - `P14-A01` (Architecture Contract: MEMORY_ENGINE.md): `done`
  - `P14-T01` (SQLite Database Initialization & Migrations): `in_progress`
  - `P14-T02` (Chat History Repository & Bounded Context Buffer): `planned`
  - `P14-T03` (User Facts & Character State Persistence): `planned`
  - `P14-T04` (Privacy Controls & Clear Memory Flow): `planned`
  - `P14-T05` (Integration Tests for Memory Engine): `planned`
  - `P14-G01` (Code Review Phase 14): `planned`

## Активная очередь (Phase 14 — Offline Memory & Relationship Persistence)

### P14-A01 — Architecture Contract: MEMORY_ENGINE.md

- **Статус:** `done`
- **Исполнитель:** `architect`
- **Зависит от:** none
- **Цель:** Создать архитектурный контракт `docs/engine/MEMORY_ENGINE.md`.
- **Критерии приёмки:**
  - [x] Описана схема таблиц SQLite (`conversation_sessions`, `messages`, `user_facts`, `memories`, `character_state`, `schema_migrations`).
  - [x] Специфицированы интерфейсы портов в Application layer (`IChatHistoryRepository`, `IUserFactsRepository`, `ICharacterStateRepository`, `IClearMemoryStore`).
  - [x] Определены лимиты контекста для AI и строгие offline-first границы.
  - [x] Описан Use Case для Clear Memory.

### P14-T01 — SQLite Database Initialization & Migrations

- **Статус:** `in_progress`
- **Исполнитель:** `app-developer`
- **Зависит от:** `P14-A01`
- **Цель:** Инициализация локальной базы SQLite (better-sqlite3 / sqlite3) в каталоге пользовательских данных Electron (`app.getPath('userData')`), система запуска миграций и транзакций по контракту `docs/engine/MEMORY_ENGINE.md`.
- **Читать:** `.agents/agents/app-developer/agent.md`, `docs/engine/MEMORY_ENGINE.md`.
- **Менять:** `src/infrastructure/persistence/` (`database.ts`, `migrations/`, `index.ts`), unit-тесты.
- **Критерии приёмки:**
  - [ ] База создаётся в изолированной директории пользователя.
  - [ ] PRAGMA (foreign_keys, WAL, synchronous=FULL, busy_timeout=5000) включены.
  - [ ] Миграции накатываются идемпотентно.
  - [ ] `npm test` и `npm run typecheck` зелёные.

### P14-T02 — Chat History Repository & Bounded Context Buffer

- **Статус:** `planned`
- **Исполнитель:** `app-developer`
- **Зависит от:** `P14-T01`
- **Цель:** Реализация порта `IChatHistoryRepository`: сохранение сессий и сообщений, выборка последних N реплик для AI.
- **Читать:** `.agents/agents/app-developer/agent.md`, `docs/engine/MEMORY_ENGINE.md`.
- **Менять:** `src/infrastructure/persistence/repositories/chat-history.repository.ts`, unit-тесты.
- **Критерии приёмки:**
  - [ ] Сессии и сообщения сохраняются с таймстемпами ISO-8601 UTC.
  - [ ] `npm test` и `npm run typecheck` зелёные.

### P14-T03 — User Facts & Character State Persistence

- **Статус:** `planned`
- **Исполнитель:** `app-developer`
- **Зависит от:** `P14-T01`
- **Цель:** Сохранение `character_state` (Needs, Relationship, Intimacy) и `user_facts` между перезапусками.
- **Читать:** `.agents/agents/app-developer/agent.md`, `docs/engine/MEMORY_ENGINE.md`.
- **Менять:** `src/infrastructure/persistence/repositories/`, unit-тесты.
- **Критерии приёмки:**
  - [ ] При перезапуске приложения прогресс отношений и потребности восстанавливаются.
  - [ ] `npm test` и `npm run typecheck` зелёные.

### P14-T04 — Privacy Controls & Clear Memory Flow

- **Статус:** `planned`
- **Исполнитель:** `app-developer`
- **Зависит от:** `P14-T02`, `P14-T03`
- **Цель:** Реализация Use Case `ClearMemoryUseCase` и IPC-метода очистки данных: сброс фактов, истории и состояния.
- **Читать:** `.agents/agents/app-developer/agent.md`, `docs/engine/MEMORY_ENGINE.md`.
- **Менять:** `src/application/use-cases/`, IPC-обработчики, unit-тесты.
- **Критерии приёмки:**
  - [ ] Полная атомарная очистка памяти без поломки запущенного Wisp.
  - [ ] `npm test` и `npm run typecheck` зелёные.

## Поздние фазы

| Фаза | Тема | Исполнитель по умолчанию |
|---|---|---|
| 15 | Shimeji & Autonomous Desktop Life (Boredom, Chains, Gaze, Physics, Window Climbing) | `domain-behavior` + `app-developer` |
| 16 | Settings & Control Surface: behavior, appearance, memory controls, full debug panel | `app-developer` |
| 17 | External AI Contract Readiness: future client-side adapter only | `architect` + `app-developer` |
| 18 | Stability & Performance Hardening: long sessions, cleanup, Wayland/X11 | `reviewer` |
| 19 | Production Packaging: Linux first, then Windows/macOS | `app-developer` |
