# Трек: Memory & AI Integration (Phase 15 & 17)

Файл бэклога оффлайн-памяти (SQLite), фактов пользователя, диалогов и интеграции с AI-провайдерами.
Архитектурные спецификации:
- [`docs/engine/MEMORY_ENGINE.md`](../../../docs/engine/MEMORY_ENGINE.md)
- [`docs/engine/AI_PROVIDER_CONTRACT.md`](../../../docs/engine/AI_PROVIDER_CONTRACT.md)

---

## 1. Текущий статус

- [x] **P10:** Mock AI Provider & Dialogue Loop. (`done`)
- [x] **MEM-ARCH:** Контракт оффлайн-памяти `MEMORY_ENGINE.md`. (`done`)
- [ ] **P15-M01:** SQLite Scaffolding, Schema & Migrations. (`planned` / `app-developer`)
- [ ] **P15-M02:** Bounded Dialog History & Episodic Memory Store. (`planned` / `app-developer`)
- [ ] **P15-M03:** User Facts Extraction & State Snapshot Persistence. (`planned` / `app-developer`)
- [ ] **P17-A01:** Client-side External AI Adapter contract. (`future`)

---

## 2. Подробные карточки задач

### [TASK: P15-M01] — SQLite Scaffolding & Migrations
- **Исполнитель:** `app-developer`
- **Цель:** Настроить локальную базу SQLite в Main-процессе, механизм миграций и IPC-мост согласно контракту `MEMORY_ENGINE.md`.
- **Читать:** `docs/engine/MEMORY_ENGINE.md`.
- **Менять:** `src/infrastructure/storage/`, `src/main/`, unit-тесты.
