# Трек: Memory & AI Integration (Phase 15 & 17)

Файл бэклога оффлайн-памяти (SQLite), фактов пользователя, диалогов и интеграции с AI-провайдерами.
Архитектурные спецификации:
- [`docs/engine/MEMORY_ENGINE.md`](../../../docs/engine/MEMORY_ENGINE.md)
- [`docs/engine/AI_PROVIDER_CONTRACT.md`](../../../docs/engine/AI_PROVIDER_CONTRACT.md)

---

## 1. Текущий статус

- [x] **P10:** Mock AI Provider & Dialogue Loop. (`done`)
- [x] **MEM-ARCH:** Контракт оффлайн-памяти `MEMORY_ENGINE.md`. (`done`)
- [ ] **P15-M01:** SQLite Scaffolding, Schema & Migrations. (`in_progress` / `app-developer`)
- [ ] **P15-M02:** Bounded Dialog History & Episodic Memory Store. (`planned` / `app-developer`)
- [ ] **P15-M03:** User Facts Extraction & State Snapshot Persistence. (`planned` / `app-developer`)
- [ ] **P17-A01:** Client-side External AI Adapter contract. (`future`)

---

## 2. Подробные карточки задач

### [TASK: P15-M01] — SQLite Scaffolding, Schema & Migrations
- **Исполнитель:** `app-developer`
- **Зависит от:** `MEM-ARCH`
- **Цель:** Реализовать инфраструктуру SQLite хранилища в Main Process согласно спецификации `docs/engine/MEMORY_ENGINE.md`:
  1. Настроить подключение к базе данных (`better-sqlite3` или `sqlite3` / pure-JS sql driver, соответствующий требованиям desktop offline-first).
  2. Создать систему миграций (версионирование схемы, таблицы `schema_migrations`, `messages`, `facts`, `character_state`).
  3. Реализовать репозиторий/порт `IMemoryStoragePort` в слое Infrastructure.
  4. Покрыть unit-тестами создание таблиц, миграции и базовые CRUD-операции.
- **Читать:**
  - `.agents/agents/app-developer/agent.md`
  - `docs/engine/MEMORY_ENGINE.md` (Разделы 1–4)
- **Менять:** `src/infrastructure/storage/`, `src/application/ports/`, тесты.
- **Критерии приёмки:**
  - [ ] SQLite инициализируется в безопасной директории данных пользователя (`userData`).
  - [ ] Миграции применяются последовательно и идемпотентно.
  - [ ] `npm test && npm run typecheck` проходят успешно.
