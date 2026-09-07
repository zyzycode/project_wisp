# Контракт движка памяти

> [!NOTE]
> **Статус документа:** Первичная (черновая) версия. Контракт ещё не согласован окончательно и находится в активной проработке.

Канонические правила локальной памяти. Изменение семантики требует Architect review. Память принадлежит Main; Domain не зависит от SQLite, Renderer не получает БД, репозитории или raw memory records.

## 1. Границы и владение

`Renderer → typed Preload/IPC → Application use case/ports → Infrastructure SQLite → local DB`.

- Domain владеет `CharacterState`, не JSON/SQL/путями/lifecycle БД.
- Application объявляет порты, оркестрирует чтение/сохранение и собирает ограниченный контекст для `IAIProvider`.
- Infrastructure реализует SQLite, миграции и параметризованные запросы; Preload/Renderer передают только команды и presentation DTO, без SQLite handles.
- База — только в `app.getPath('userData')`, без cloud sync, аккаунта, сети, API-ключа или локального сервера. Внешний provider получает явно собранный context, не файл БД/SQLite dump.

## 2. Схема SQLite

Путь и библиотека SQLite не входят в public ports. Все persistence timestamps — UTC ISO-8601 с `Z` (§ «Инициализация»).

### `conversation_sessions`

MVP: одна сессия на запуск Main, один `app_run_id`. Сессию создавать при первом сохранённом сообщении, не при старте/chat UI/смене дня или темы. Все сообщения запуска относятся к ней; штатное завершение выставляет `ended_at`. При следующем запуске незавершённые сессии закрыть текущим временем **до** создания новой. Модель допускает несколько сессий на будущий запуск без изменения ссылок `messages`; автоматическая сегментация/summary отложены.

| Колонка | SQLite type | Правило |
|---|---|---|
| `id` | `TEXT` | primary key |
| `app_run_id` | `TEXT` | not null; идентификатор запуска Main process, создавшего сессию |
| `started_at` | `TEXT` | not null |
| `ended_at` | `TEXT` | nullable; `null` у активной сессии |
| `summary` | `TEXT` | nullable; компактный итог старого разговора для будущего use case |

### `messages`

Append-only дословная история.

| Колонка | SQLite type | Правило |
|---|---|---|
| `id` | `TEXT` | primary key |
| `conversation_session_id` | `TEXT` | not null; foreign key to `conversation_sessions(id)` |
| `role` | `TEXT` | not null; MVP Application создаёт только `user` или `assistant` |
| `content` | `TEXT` | not null |
| `created_at` | `TEXT` | not null |

Индексы: `messages(conversation_session_id, created_at DESC)` и `messages(created_at DESC)` для сессии/FIFO. SQL CHECK для `role` нет: словарь принадлежит Application, будущие `system`/`tool` не требуют миграции. Публичный MVP DTO допускает только `user | assistant`.

### `user_facts`

Singleton/current-state знания: один `fact_key` — максимум одно актуальное значение. Множества через `hobby.1` или JSON-массив в `fact_value` запрещены до отдельного cardinality-решения.

| Колонка | SQLite type | Правило |
|---|---|---|
| `id` | `TEXT` | primary key |
| `fact_key` | `TEXT` | not null, unique; стабильный Application key |
| `fact_value` | `TEXT` | not null |
| `confidence` | `REAL` | not null, `0..1` |
| `source_message_id` | `TEXT` | nullable foreign key to `messages(id)` |
| `created_at` | `TEXT` | not null |
| `updated_at` | `TEXT` | not null |

Upsert по `fact_key` заменяет значение и обновляет `source_message_id`, `confidence`, `updated_at`. Утративший актуальность факт без замены удаляется через `removeByKey`; событие может сохраниться в `memories`.

MVP извлекает только явные однозначные утверждения. `confidence` — уверенность извлечения/нормализации, не догадка. Inferred facts и `origin = explicit | inferred` требуют отдельного use case и аддитивной миграции; новое explicit исправляет старое explicit, inferred никогда автоматически не заменяет explicit.

`source_message_id` — последняя основная реплика для текущего значения. Версии, soft-delete, `fact_evidence`, provenance graph и ручное редактирование отложены.

### `memories`

Эпизоды значимых событий/переживаний/совместного опыта; не заменяют актуальные `user_facts`.

| Колонка | SQLite type | Правило |
|---|---|---|
| `id` | `TEXT` | primary key |
| `type` | `TEXT` | not null; MVP Application создаёт `event`, `experience` или `relationship` |
| `content` | `TEXT` | not null |
| `importance` | `INTEGER` | not null, `0..100` |
| `source_message_id` | `TEXT` | nullable foreign key to `messages(id)` |
| `created_at` | `TEXT` | not null |
| `last_accessed_at` | `TEXT` | not null; первоначально равно `created_at`; время последнего включения в AI context |
| `event_at` | `TEXT` | nullable; когда событие произошло или ожидается |
| `expires_at` | `TEXT` | nullable |

Индекс: `memories(expires_at, importance DESC, last_accessed_at DESC)`. `created_at` — сохранение, `event_at` — произошедшее/ожидаемое событие, `expires_at` — запрет recall, **не** физическое удаление. Наступление `event_at` не исключает recall. `valid_until`, забывание, ranking и очистка просроченного отложены. SQL CHECK для `type` нет: `MemoryType` принадлежит Application.

Текущая цель/предпочтение — fact; начало/прогресс/завершение цели — `event`, изменение предпочтения — `experience`. Например, «разрабатываю Wisp» — текущий проект, «закончил анимацию» — событие, а не вечный fact.

### `character_state`

Не более одной записи `singleton`: динамическое состояние, не постоянная identity Wisp.

| Колонка | SQLite type | Правило |
|---|---|---|
| `id` | `TEXT` | primary key; literal `singleton` |
| `snapshot_json` | `TEXT` | not null; версионированный JSON-конверт Application snapshot |
| `updated_at` | `TEXT` | not null |

`snapshot_json = { snapshotVersion, state }`; версия snapshot независима от SQLite schema, колонка `snapshot_version` не нужна. Adapter только читает/пишет конверт; Application передаёт старую версию чистому `CharacterStateSnapshotMigrator`, затем Domain валидирует `CharacterState`.

`state` включает `Needs`, `Relationship`, `IntimacyState`, динамику характера. Preset/базовые оси/hard-soft limits принадлежат Character/configuration. SQLite не интерпретирует поля: validation, mapper, migrator и defaults принадлежат Application/Domain; нормализация domain snapshot в колонки запрещена.

### `schema_migrations`

| Колонка | SQLite type | Правило |
|---|---|---|
| `version` | `INTEGER` | primary key |
| `name` | `TEXT` | not null |
| `applied_at` | `TEXT` | not null |

Infrastructure применяет миграции в транзакции **до** доступа к репозиториям. `PRAGMA user_version` — текущая версия, `schema_migrations` — диагностический журнал; обновлять атомарно. SQL только параметризованный.

### Инициализация и формат времени

На каждом connection:

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
PRAGMA busy_timeout = 5000;
```

Foreign keys обеспечивают целостность, WAL — чтение при короткой записи, FULL (не NORMAL) — сохранность подтверждённой записи при потере питания; timeout ограничивает будущую конкуренцию. Main — единственный владелец connection.

Формат всех timestamps: `YYYY-MM-DDTHH:mm:ss.sssZ` (например, `2026-08-29T04:15:31.123Z`). Local time, ISO без timezone и Unix timestamps запрещены. Числовое Domain-время преобразует Application mapper при сериализации `snapshot_json`.

## 3. DTO и порты Application layer

Типы: [memory-repository.interface.ts](../../src/application/ports/memory-repository.interface.ts).

### Ключевые инварианты:

- Persistence timestamps — формат §2. Сущности immutable, кроме `ended_at`/`summary` сессий и `fact_value`/`confidence` фактов; изменения lifecycle-полей описаны в соответствующих таблицах.
- SQLite/`better-sqlite3` доступны только Infrastructure. Application использует `IChatHistoryRepository`, `IUserFactsRepository`, `ICharacterStateRepository`, `IClearMemoryStore`; Renderer не получает БД/файлы.
- `MemoryRecord`/`ConversationSession` фиксируют схему; их repository ports отложены до extraction/summary/retrieval use cases.
- `IClearMemoryStore` отделён от CRUD ради атомарного сброса всех таблиц. `ICharacterStateRepository` возвращает `PersistedCharacterStateSnapshot`; в актуальный state преобразует Application, не SQLite adapter.

### Сознательно отложенные поля

Без use cases не добавлять `scope`, `slot_key`, `origin`, `status`, `valid_from`, `valid_until`, `last_confirmed_at`, `superseded_by_id`, `title`, `recall_count`, `source_session_id`, `reply_to_message_id`, `provider`, `model`, `metadata_json`.

## 4. Ограниченный контекст для Mock AI

`AIProviderRequest.recentContext` из [AI contract](AI_PROVIDER_CONTRACT.md) собирает Application через `IChatHistoryRepository`; provider репозитории не вызывает.

`ChatContextLimits` / `DEFAULT_CHAT_CONTEXT_LIMITS`: `maxMessages = 20`, `maxTotalCharacters = 8_000`, `maxCharactersPerMessage = 2_000`. Это именованные Application policy defaults, передаваемые сборщику; не Renderer controls, настройки пользователя, SQLite data или скрытые числа. Тесты могут передавать меньшие лимиты.

Детерминированный FIFO: взять последние `maxMessages`, вернуть хронологический порядок, отбрасывать старейшие до общего лимита. Длинную реплику обрезать до per-message лимита только в `recentContext`, не в сохранённой истории. MVP передаёт `MockAIProvider` только эту историю и `CharacterSnapshot`; facts/memories/session summaries не добавлять неявно до отдельных retrieval/context-задач.

## 5. Очистка памяти

Единственная Application-точка — `ClearMemoryUseCase` через typed IPC; Renderer не выбирает таблицы и не исполняет SQL. `IClearMemoryStore.clearUserMemory()` удаляет в **одной транзакции**, в порядке FK:

1. `user_facts`;
2. `memories`;
3. `messages`;
4. `conversation_sessions`;
5. singleton `character_state`.

Сохранить файл БД, схему, `schema_migrations`, identity/configuration и настройки приложения. После успеха Application восстанавливает default dynamic `CharacterState` из immutable preset: сбрасывает `Relationship`, `IntimacyState`, приобретённые черты/предпочтения и runtime (`Needs`, mood, cooldowns); удаляет старую историю/facts/memories/snapshot из памяти процесса.

При ошибке — rollback и нейтральная typed Application/IPC error без SQL/путей в UI. Это memory reset, не factory reset; appearance/behavior settings сохраняются. UI-редактирование отдельных facts/memories вне MVP.

## 6. Явные нецели

- Cloud sync, telemetry export, внешние LLM SDK, backend/proxy/server, пользовательские AI credentials.
- Автоизвлечение facts/memories, сегментация/summary, semantic search, embeddings, recall ranking, забывание.
- Multi-value/inferred facts, `origin`, `fact_evidence`/provenance до отдельных use cases.
- SQL, Node.js, Electron и persistence types в Domain, Renderer, public Preload API, DTO `IAIProvider` или `CharacterEngine`.
