# Контракт движка памяти

> [!NOTE]
> **Статус документа:** Первичная (черновая) версия. Контракт ещё не согласован окончательно и находится в активной проработке.

`MEMORY_ENGINE.md` — основной источник правил для локальной памяти Project
Wisp. Он фиксирует модель хранения, порты Application layer, границы
AI-контекста и сценарий очистки памяти до появления SQLite-реализации.

Память принадлежит Main process. Domain не зависит от SQLite, а Renderer не
имеет доступа ни к базе, ни к репозиториям. Implementer-агенты не изменяют
этот контракт без Architect review.

## 1. Границы и владение

```text
Renderer UI
  -> typed preload / IPC command
  -> Application use case + application/ports
  -> Infrastructure SQLite adapters
  -> local SQLite database
```

- **Domain:** владеет значением `CharacterState`, но не JSON, SQL, путями к
  файлам и жизненным циклом базы.
- **Application:** объявляет порты, оркестрирует сохранение и чтение, собирает
  ограниченный контекст для `IAIProvider`.
- **Infrastructure:** реализует порты через SQLite, применяет миграции и
  параметризованные запросы.
- **Renderer / Preload:** передают только типизированные команды и DTO для
  отображения; они не получают raw memory records или SQLite handles.

Память реализует offline-first принцип: база находится только в
`app.getPath('userData')`, не синхронизируется с облаком и не требует аккаунта,
сети, API-ключа или локального сервера. Будущий внешний provider получает
только явно собранный Application context, а не файл БД и не произвольный
SQLite dump.

## 2. Схема SQLite

SQLite — деталь Infrastructure в Main process. Путь базы и библиотека не
входят в public ports. Все timestamps хранятся как UTC ISO-8601 strings.

### `conversation_sessions`

Логическая сессия диалога. Она создаётся при первом сохранённом сообщении
нового запуска и закрывается простым lifecycle-событием Application;
автоматическая сегментация и генерация summary не входят в MVP.

Для MVP одна сессия соответствует одному запуску приложения:

1. при старте приложения активная сессия не создаётся;
2. при первом сохранённом сообщении Application создаёт сессию;
3. все сообщения этого запуска принадлежат ей;
4. при штатном завершении Application устанавливает `ended_at`;
5. при следующем запуске Application закрывает все незавершённые сессии
   прошлого запуска текущим временем до создания новой.

Сессия не зависит от открытия chat UI, календарного дня или темы разговора.
Application создаёт один `app_run_id` на запуск Main process и записывает его
в новую сессию. Сейчас на один запуск приходится одна сессия, но позже один
запуск сможет содержать несколько сессий без изменения ссылок из `messages`.

| Колонка | SQLite type | Правило |
|---|---|---|
| `id` | `TEXT` | primary key |
| `app_run_id` | `TEXT` | not null; идентификатор запуска Main process, создавшего сессию |
| `started_at` | `TEXT` | not null |
| `ended_at` | `TEXT` | nullable; `null` у активной сессии |
| `summary` | `TEXT` | nullable; компактный итог старого разговора для будущего use case |

### `messages`

Append-only история дословных реплик.

| Колонка | SQLite type | Правило |
|---|---|---|
| `id` | `TEXT` | primary key |
| `conversation_session_id` | `TEXT` | not null; foreign key to `conversation_sessions(id)` |
| `role` | `TEXT` | not null; MVP Application создаёт только `user` или `assistant` |
| `content` | `TEXT` | not null |
| `created_at` | `TEXT` | not null |

Индексы: `messages(conversation_session_id, created_at DESC)` для выборки
сессии и `messages(created_at DESC)` для FIFO-буфера.

SQLite не вводит CHECK-ограничение для `role`: новые внутренние роли
(`system` или `tool`) не должны требовать миграции таблицы. Разрешённые
значения остаются Application-инвариантом; публичный MVP DTO принимает только
`user | assistant`.

### `user_facts`

Актуальные, относительно устойчивые знания о пользователе. Это не журнал
событий и не версии профиля.

MVP поддерживает только singleton/current-state facts: один `fact_key`
имеет максимум одно актуальное значение. Нельзя кодировать множества ключами
вида `hobby.1` или хранить неявный JSON-массив в `fact_value`.
Многозначные facts являются отдельным будущим расширением с собственным
решением о cardinality; до него они не становятся структурированными facts.

| Колонка | SQLite type | Правило |
|---|---|---|
| `id` | `TEXT` | primary key |
| `fact_key` | `TEXT` | not null, unique; стабильный Application key |
| `fact_value` | `TEXT` | not null |
| `confidence` | `REAL` | not null, `0..1` |
| `source_message_id` | `TEXT` | nullable foreign key to `messages(id)` |
| `created_at` | `TEXT` | not null |
| `updated_at` | `TEXT` | not null |

`fact_key` разрешает upsert: новое актуальное значение заменяет прежнее и
обновляет `source_message_id`, `confidence` и `updated_at`. Если пользователь
сообщил, что факт больше не актуален и нового значения нет, Application
удаляет его через `removeByKey`. Например, после «я уволился из X» ключ
`current_company` удаляется; значимое событие при необходимости сохраняется в
`memories`, а `X` не остаётся актуальным фактом.

В MVP facts основываются только на явных, достаточно однозначных утверждениях
пользователя. `confidence` означает уверенность извлечения/нормализации, а
не догадку о пользователе. Inferred facts и поле `origin` не вводятся до
появления отдельного use case; тогда `origin = explicit | inferred` добавится
аддитивной миграцией. Будущая политика конфликтов неизменна: новое explicit
исправление заменяет старое explicit, а inferred факт никогда не заменяет
explicit автоматически.

`source_message_id` — последняя основная реплика, на которой основано
текущее значение, а не полный provenance graph. История версий, soft-delete,
`fact_evidence` и ручное редактирование facts в MVP не вводятся.

### `memories`

Эпизодическая долговременная память: значимые события, переживания, цели,
предпочтения и совместная история. Она не подменяет `user_facts`.

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

Индекс: `memories(expires_at, importance DESC, last_accessed_at DESC)`.
Время события, актуальность и хранение — разные понятия. `created_at`
показывает, когда Wisp сохранила запись; `event_at` — когда событие
произошло или произойдёт; `expires_at` — когда память больше не допускается
к recall. Наступление `event_at` не исключает запись из recall: «завтра
собеседование в 15:00» после собеседования остаётся доступным поводом спросить,
как оно прошло. `expires_at` не удаляет запись физически. Отдельные
`valid_until`, алгоритм забывания, ранжирование и физическая очистка
просроченных записей — будущие задачи.

SQLite не вводит CHECK-ограничение для `type`: словарь MemoryType принадлежит
Application и может расширяться аддитивно без изменения схемы.

Пример «Сегодня наконец закончил анимацию ходьбы для Project Wisp» создаёт
`memory` типа `event`, а не неизменяемый факт `user_finished_walk_animation`.
Напротив, «Я сейчас разрабатываю Project Wisp» может создать или обновить
`user_facts.current_project = Project Wisp`. Fact — актуальное утверждение
о пользователе или его мире; memory — конкретный эпизод, событие либо
совместный опыт. Устойчивое предпочтение — fact, а эпизод его изменения —
`experience`; текущая цель — fact, а её начало/прогресс/завершение — `event`.

### `character_state`

В таблице существует не более одной записи с фиксированным ключом
`singleton`. Она хранит только динамическое состояние; постоянная identity
Wisp не является пользовательской памятью.

| Колонка | SQLite type | Правило |
|---|---|---|
| `id` | `TEXT` | primary key; literal `singleton` |
| `snapshot_json` | `TEXT` | not null; версионированный JSON-конверт Application snapshot |
| `updated_at` | `TEXT` | not null |

`snapshot_json` имеет форму `{ snapshotVersion, state }`. Версия относится
к формату domain snapshot, а не к SQLite schema; поэтому отдельная колонка
`snapshot_version` не нужна. SQLite adapter только читает и записывает
конверт. Application передаёт старую версию в чистый
`CharacterStateSnapshotMigrator`, который преобразует её в актуальную форму,
после чего Domain валидирует `CharacterState`.

В `state` могут находиться `Needs`, `Relationship`, `IntimacyState` и
динамические изменения характера. Неподвижная identity Wisp — выбранный preset,
его базовые оси и hard/soft limits — принадлежит Character Engine/configuration
и не извлекается из пользовательской памяти. SQLite не интерпретирует поля
снимка: validation, маппинг, migrator и default state принадлежат
Application/Domain. Нормализация доменных моделей в колонки запрещена этим
MVP-контрактом.

### `schema_migrations`

Технический журнал применённых миграций.

| Колонка | SQLite type | Правило |
|---|---|---|
| `version` | `INTEGER` | primary key |
| `name` | `TEXT` | not null |
| `applied_at` | `TEXT` | not null |

Миграции применяются Infrastructure в транзакции до доступа к репозиториям.
`PRAGMA user_version` — источник текущей версии схемы; `schema_migrations` —
читаемый журнал для диагностики. Их значения изменяются в одной транзакции.
SQL-запросы должны быть параметризованы.

### Инициализация и формат времени

Каждое SQLite connection устанавливает:

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
PRAGMA busy_timeout = 5000;
```

`foreign_keys` обязателен для ссылочной целостности и включается на каждом
connection. WAL подходит для локальной desktop-базы: он допускает чтение во
время короткой записи. Для небольшого объёма памяти выбран `synchronous =
FULL`, а не `NORMAL`: это уменьшает риск потери последней подтверждённой
записи при внезапном выключении питания. `busy_timeout` — защитный предел
для будущих конкурентных обращений; Main process остаётся единственным
владельцем соединения.

Все timestamps persistence-модели имеют единую форму UTC ISO-8601 с суффиксом
`Z`, например `2026-08-29T04:15:31.123Z`. В SQLite-колонках запрещено
смешивать local time, ISO-строки без timezone и Unix timestamps. Если Domain
использует числовое время для расчётов, Application mapper преобразует его при
сериализации `snapshot_json`; формат persistence остаётся ISO-8601 UTC.

## 3. DTO и порты Application layer

Контракты репозиториев и сущности DTO определены в коде: [src/application/ports/memory-repository.interface.ts](../../src/application/ports/memory-repository.interface.ts).

### Ключевые инварианты:
- **Временные метки:** Все timestamps persistence-модели имеют строгий формат UTC ISO-8601 (`YYYY-MM-DDTHH:mm:ss.sssZ`). Смешивание с local time, строками без таймзоны или Unix timestamp запрещено.
- **Неизменяемость:** Сущности неизменяемы после создания (кроме `ended_at`/`summary` в сессиях и `fact_value`/`confidence` в фактах).
- **Изоляция:** Прямой доступ к SQLite и `better-sqlite3` изолирован в Infrastructure-адаптерах; Application работает только через порты `IChatHistoryRepository`, `IUserFactsRepository`, `ICharacterStateRepository`, `IClearMemoryStore`. Renderer не имеет доступа к SQLite или файлам БД.

DTO `MemoryRecord` и `ConversationSession` определены для владения схемой, но отдельные repository ports отложены до появления use cases для извлечения, summary или retrieval.
`IClearMemoryStore` намеренно отделён от CRUD-портов: его операция должна быть атомарна для всех таблиц пользовательской памяти.
`ICharacterStateRepository` возвращает версионированный сериализуемый DTO (`PersistedCharacterStateSnapshot`); Application, а не SQLite adapter, преобразует его в актуальный `CharacterState`.

### Сознательно отложенные поля

Таблицы не получают универсальные `scope`, `slot_key`, `origin`, `status`, `valid_from`, `valid_until`, `last_confirmed_at`, `superseded_by_id`, `title`, `recall_count`, `source_session_id`, `reply_to_message_id`, `provider`, `model` или `metadata_json`. Сейчас ни один Application use case не читает и не изменяет эти данные.

## 4. Ограниченный контекст для Mock AI

`AIProviderRequest.recentContext` из `AI_PROVIDER_CONTRACT.md` собирается
Application из `IChatHistoryRepository`; provider никогда не обращается к
репозиторию.

```ts
export interface ChatContextLimits {
  maxMessages: number;
  maxTotalCharacters: number;
  maxCharactersPerMessage: number;
}

export const DEFAULT_CHAT_CONTEXT_LIMITS: ChatContextLimits = {
  maxMessages: 20,
  maxTotalCharacters: 8_000,
  maxCharactersPerMessage: 2_000,
};
```

Это именованные Application policy defaults, передаваемые сборщику контекста;
они не являются Renderer controls, пользовательскими настройками, SQLite data
или скрытыми числами в use case. Тесты могут передавать меньшие лимиты.

Выборка детерминирована и работает как FIFO: загрузить новые
`maxMessages` записей, восстановить хронологический порядок, затем отбросить
самые старые сообщения, пока не соблюдён общий лимит символов. Сообщение
длиннее `maxCharactersPerMessage` Application обрезает только перед передачей
в `recentContext`; исходная сохранённая реплика не изменяется. Текущий MVP
передаёт в `MockAIProvider` только эту ограниченную дословную историю и
`CharacterSnapshot`. Facts, memories и session summaries сохраняются для
будущих отдельных задач retrieval/context и не добавляются в provider request
неявно.

## 5. Очистка памяти

`ClearMemoryUseCase` — единственная точка входа Application для полного
сброса памяти. Его может вызвать типизированная IPC-команда; Renderer не
выбирает таблицы и не исполняет SQL-удаление.

Use case вызывает `IClearMemoryStore.clearUserMemory()`. Реализация в
Infrastructure выполняет одну транзакцию и удаляет записи в безопасном для
foreign keys порядке:

1. `user_facts`;
2. `memories`;
3. `messages`;
4. `conversation_sessions`;
5. singleton из `character_state`.

Она сохраняет файл базы, схему, `schema_migrations`, identity/configuration
Wisp и настройки приложения. После успеха Application создаёт default dynamic
`CharacterState` из неизменяемого preset: сбрасываются `Relationship`,
`IntimacyState`, пользовательски обусловленные изменения характера,
предпочтения Wisp и runtime-состояние (`Needs`, mood, cooldowns). В памяти
процесса не остаётся устаревшей истории, facts, memories или state snapshot.
При ошибке транзакция откатывается и существующее сопоставление ошибок
Application/IPC возвращает нейтральную типизированную ошибку без SQL или
деталей файловой системы в UI.

Это memory reset, а не factory reset: он намеренно не удаляет настройки
внешности/поведения и технические метаданные миграций. Редактирование
отдельных facts или memories через UI не входит в MVP.

## 6. Явные нецели

- Нет cloud sync, telemetry export, внешних LLM SDK, backend/proxy/server или
  пользовательских AI credentials.
- Нет автоматического извлечения facts и memories, сегментации сессий,
  генерации summary, semantic search, embeddings, ранжирования recall или
  алгоритма забывания.
- Нет multi-value facts, inferred facts, `origin`, `fact_evidence` или
  provenance graph до отдельных Application use cases.
- Нет SQL, Node.js, Electron или persistence types в Domain, Renderer,
  публичном Preload API, DTO `IAIProvider` или `CharacterEngine`.
