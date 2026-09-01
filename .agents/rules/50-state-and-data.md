# Состояние и данные

## Владение состоянием

- Local UI state живёт в React-компоненте.
- Общий presentation state живёт в Renderer store.
- Domain state и state machines живут в Main/Application/Domain.
- Persistent state доступен через application repositories, реализованные Main/Infrastructure adapters.

Renderer не знает о SQLite, SQL, filesystem, provider internals и raw memory entries.

## DTO и persistence

- Через IPC передаются только serializable DTO: примитивы, plain objects и массивы без методов, прототипов и циклов.
- Формат времени задаёт профильный контракт; persistence memory использует UTC ISO-8601 по `MEMORY_ENGINE.md`.
- SQLite доступен только в Main через ports вроде `IMemoryRepository` и `ISettingsRepository`.
- Изменение схемы оформляй детерминированной транзакционной миграцией; текущую версию хранит `PRAGMA user_version`.
- Имена таблиц и колонок — `snake_case`; конкретная memory schema определяется `docs/engine/MEMORY_ENGINE.md`.

## Приватность памяти

- Facts, episodic memories, summaries и character snapshot не смешивай: используй классификацию профильного контракта.
- Память остаётся provider-neutral и локальной, пока отдельный контракт явно не разрешит другое.
- Полная очистка удаляет историю, facts, memories, summaries и persisted character state без устаревшего cache.
- Renderer может показывать безопасный агрегированный статус и вызывать clear action, но не раскрывает внутренние записи.
