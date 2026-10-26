# Контракт движка памяти

Статус: принятые архитектурные решения (базовая persistence, lifecycle, явные знания и recall; расширения). §1–8 — базовая persistence и lifecycle; §9 — явные знания и recall; §10–16 — расширения памяти и контекста. [Выбор драйвера](../adr/ADR-016-local-memory-sqlite.md#decision).

## 1. Границы, владение и источник истины

`Renderer → typed Preload/IPC → Application → Infrastructure → SQLite worker`.

- Domain владеет семантикой Character/Activity, не JSON, SQL, временем ОС или lifecycle БД.
- Application владеет use cases, generation, IDs/временем через инъекции, проекцией состояния и bounded context. Хранение, подбор воспоминаний и сборка provider context — разные обязанности.
- Main создаёт один persistence adapter и управляет его lifecycle. Connection принадлежит единственному Infrastructure `node:worker_threads` worker внутри процесса Main. Это не второй Brain, не backend и не Renderer worker: никаких Electron/UI/provider/Domain effects в нём.
- Worker выполняет последовательные короткие транзакции `better-sqlite3@13.0.3`; Main не выполняет синхронный SQL. Typed сообщения worker — приватный Infrastructure transport, SQL/пути не являются командами Application или IPC. Входы и ответы проверяются из `unknown`; fatal worker error завершает все ожидающие операции нейтральной ошибкой.
- Локальный файл `path.join(app.getPath('userData'), 'memory', 'wisp.sqlite3')` — источник истины **подтверждённых сохранений** одного локального пользователя/экземпляра персонажа. Живой CharacterState принадлежит Domain/Application; БД — его последний checkpoint. Preset/configuration — источник identity/caps. Повторный запуск portable-приложения из другого каталога использует тот же userData, пока профиль не изменён.
- MVP не привязывает БД к backend login. Смена аккаунта/несколько персонажей и автоматический перенос памяти требуют отдельного identity/privacy gate; запрещено молча присваивать локальную историю новому аккаунту.
- Сеть, аккаунт и provider не нужны для открытия/записи/restore. Renderer получает только presentation DTO; OS-specific ветвления остаются за `IPlatformAdapter` в `frontend/src/infrastructure/platform/`.

## 2. Схема SQLite v1

Типы — [memory-repository.interface.ts](../../src/application/ports/memory-repository.interface.ts) и [character-memory-snapshot.ts](../../src/application/ports/character-memory-snapshot.ts). Имена/пути драйвера не входят в public ports. Все таблицы создаются одной первой миграцией; ORM не нужен.

### `conversation_sessions`

Одна сессия на `app_run_id`; создаётся лениво в транзакции первого завершённого turn. `app_run_id` — UUID запуска Main, не dialogue conversationId и не renderer streamId. После полного memory reset создаётся новый app_run_id для памяти. Dialogue reset/reload не создают storage session.

| Колонка | SQLite type | Правило |
|---|---|---|
| `id` | `TEXT` | primary key, not null |
| `app_run_id` | `TEXT` | not null, unique |
| `started_at` | `TEXT` | not null; время user-сообщения первой сохранённой пары |
| `ended_at` | `TEXT` | nullable; штатное закрытие либо время следующего запуска |

Перед первой новой записью закрыть незавершённые сессии; `ended_at = max(started_at, suppliedNow)` защищает от отката часов. Нет пустых сессий после неуспешной записи пары. Summary и автоматическая сегментация не требуются MVP; Хранилище использует пары исходных сообщений без новой таблицы.

### `messages`

Дословная история **завершённых показанных turn**. Success и показанный безопасный fallback сохраняются как пара; error/reset/cancel до terminal не сохраняют половину. Это история разговоров, не аудит каждого нажатия Send. Принятый turn сначала публикует runtime-результат, затем ставится в очередь записи; crash до commit может потерять эту пару.

| Колонка | SQLite type | Правило |
|---|---|---|
| `sequence` | `INTEGER` | primary key autoincrement; внутренний порядок вставки |
| `id` | `TEXT` | not null, unique; стабильный ID сообщения Application |
| `conversation_session_id` | `TEXT` | not null, FK → `conversation_sessions(id)`, delete restrict |
| `role` | `TEXT` | not null; Application допускает `user` / `assistant` |
| `content` | `TEXT` | not null; текст после действующей input/reply validation |
| `created_at` | `TEXT` | not null |

Индекс `messages(conversation_session_id, sequence)`. Общий порядок — `sequence`, а не часы/случайные UUID; равные timestamps и откат часов его не меняют. В паре user вставляется перед assistant. `sequence` не покидает adapter. SQL enum CHECK для роли не нужен, чтение неизвестной роли даёт `invalid_data`.

`appendTurn` атомарно создаёт session при отсутствии и обе реплики; обе ссылки обязаны совпадать с session.id. Повтор тех же IDs с идентичным payload — успех без новых строк; иной payload, частично существующая пара или конфликт session — `conflict`, rollback. IDs и timestamps создаются один раз до попытки записи. Изменять существующий текст/использовать `INSERT OR REPLACE` запрещено.

### `user_facts`

Один стабильный `fact_key` — одно текущее скалярное значение. Массивы/наборы через JSON или суффиксы ключей до cardinality gate запрещены.

| Колонка | SQLite type | Правило |
|---|---|---|
| `id` | `TEXT` | primary key, not null |
| `fact_key` | `TEXT` | not null, unique |
| `fact_value` | `TEXT` | not null |
| `confidence` | `REAL` | not null, CHECK 0..1 |
| `source_message_id` | `TEXT` | nullable FK → `messages(id)`, delete restrict |
| `created_at` | `TEXT` | not null |
| `updated_at` | `TEXT` | not null |

Upsert по key сохраняет исходные id/created_at, заменяет value/confidence/source, выставляет supplied updated_at. Application передаёт candidate id и timestamps; Infrastructure не генерирует время/семантику. Последняя принятая операция побеждает, часы не разрешают конфликт; updated_at нормализуется не ниже created_at. `removeByKey` идемпотентен. `list` сортирует по fact_key с BINARY collation.

Хранилище принимает только уже проверенные явные факты и существующий source_message_id; null допустим лишь для доверенного локального ввода вне разговора. Confidence — уверенность нормализации, не разрешение домысливать. Извлечение, inferred facts, evidence/history, определения ключей и автоматический вызов upsert из диалога вынесены за рамки базового хранилища.

### `game_episodes`

Минимальный структурированный первичный опыт, без LLM-текста, importance или inferred preference.

| Колонка | SQLite type | Правило |
|---|---|---|
| `app_run_id`, `activity_run_id` | `TEXT` | not null; составной primary key |
| `kind` | `TEXT` | not null; `cursor_game` |
| `outcome` | `TEXT` | not null; реальный `CursorGameOutcome` |
| `play_completed` | `INTEGER` | not null, CHECK = 1 |
| `executed_ms` | `REAL` | not null, CHECK >= 0; finite на границе |
| `ended_at` | `TEXT` | not null; UTC время terminal |

Источник — [CursorGameResult](../../src/application/ports/cursor-game-contract.ts) из единственного terminal callback Activity. Сохранять только `playCompleted=true`, включая cancelled/lost_target **после** подтверждённой play phase; до неё записи нет. Не превращать cancelled в caught и не выводить исход из UI/реплики/анимации. Application конвертирует явное atMs через согласованную Main clock mapping в UTC; монотонное время не трактовать как epoch.

Составной ключ защищает от повторного terminal, перезапуска и повторного использования activityRunId. Идентичный повтор — no-op; отличный payload того же ключа — `conflict`, первая запись сохраняется. `IGameEpisodeRepository.append` — единственный необходимый порт; recall/list подключается вместе с его потребителем. Ошибка сохранения не отменяет уже применённый play effect и не повторяет его.

### `character_state`

| Колонка | SQLite type | Правило |
|---|---|---|
| `id` | `TEXT` | primary key, not null, CHECK = 'singleton' |
| `snapshot_json` | `TEXT` | not null; конверт `{ snapshotVersion, state }` |
| `updated_at` | `TEXT` | not null; время checkpoint |

Формы v1/v2 заданы в [character-memory-snapshot.ts](../../src/application/ports/character-memory-snapshot.ts), версия envelope независима от schema; v2 добавляет cardRevision=2 при presetId=curiousStubbornGirl. Сохраняются Needs, Relationship, Intimacy, current axes и preferences. Без копии base/soft/hard limits, plasticity, displayName/self-concept. Нет FSM/Activity/Motion, окон, stream/request IDs, pending provider, quiet/quietSupport, cooldowns или lastUpdated системных часов. Адаптер проверяет JSON/envelope, Application мигрирует state, Domain проверяет значения относительно установленного preset (§4).

### `schema_migrations`

| Колонка | SQLite type | Правило |
|---|---|---|
| `version` | `INTEGER` | primary key, positive |
| `name` | `TEXT` | not null; неизменное имя миграции |
| `applied_at` | `TEXT` | not null |

`PRAGMA user_version` и непрерывный журнал обязаны совпадать. Каждая последовательная миграция обновляет DDL/data, журнал и user_version в одной транзакции. Уже применённый SQL не редактировать; новые изменения — новая версия. Непустая БД без известной версии, разрыв журнала или несовпадение имени — `corrupt`, будущая версия — `unsupported_version`. Нет down-migration, неявного DROP/recreate или автоматического исправления журнала.

### Retention и расширение

MVP хранит подтверждённые сообщения, текущие факты, игровые эпизоды и один checkpoint до явного полного reset. Нет TTL/автоудаления истории по лимиту AI context; при заполнении диска — §4. Локальные записи не экспортируются в telemetry; логи содержат код операции/ошибки без текста, snapshot, SQL и пути. Обобщённые `memories`, summary, FTS/vector tables, ranking/expiry и их порты из прежнего черновика **не входят в schema v1**: актуальных use cases на этом этапе нет. Игровой эпизод имеет реальный потребитель записи. Будущий recall читает исходные записи через Application ports; index является производным, с устойчивой ссылкой на источник, обновлением/удалением и перестроением. Потеря индекса не означает потерю памяти. Формат и миграция индекса — отдельный gate, пустые providers/adapters не создавать.

## 3. Connection, операции и ошибки

На connection: `foreign_keys=ON`, `journal_mode=WAL`, `synchronous=FULL`, `busy_timeout=5000`, `trusted_schema=OFF`; проверить фактически установленные значения. Defensive mode включён по умолчанию, `unsafeMode(true)` и вызовы `loadExtension` запрещены. WAL недоступен — `unavailable`, без молчаливого downgrade durability. Данные параметризованы, SQL/DDL только встроенные; путь не приходит из IPC. Infrastructure сериализует **все** repo operations/reset/shutdown через один worker. Никаких await внутри SQL transaction. Очередь ограничена 100 ожидающими командами, переполнение → `busy`; latest checkpoint coalescing вместо накопления кадров. Для reset/close оставить управляющий слот. При I/O ошибке нет бесконечного retry; write acknowledgment только после commit. Promise timeout не доказывает rollback: без acknowledgment запись имеет неопределённый исход; разрешён только повтор тех же IDs, а не новый ID. `MemoryResult` типизирует ожидаемые ошибки; `stale` — отброшенная generation, `invalid_data` — row/payload validation, `conflict` — конфликт идентичности, остальные — storage/capability failure. Raw exception не пересекает adapter. Generation — non-negative safe integer, начальная 0; reset принимает ровно current+1, остальные операции — только current. Неожиданная ошибка и невозможность восстановить очередь переводятся в unavailable. Все аргументы валидируются, включая finite numbers, длины и read limit 1..100; ошибочный limit не означает SELECT без LIMIT. IDs non-empty до 128 UTF-16 units, fact key до 128, value до 2000; сообщения используют [диалоговые лимиты](AI_PROVIDER_CONTRACT.md#контекст-reset-и-lifecycle). Все даты — `YYYY-MM-DDTHH:mm:ss.sssZ`, с проверкой календарной валидности. UTC clock и monotonic deadlines различны. Envelope ограничен 1 MiB UTF-8, preferences — 256 ключами по 128 UTF-16 units; эти storage caps не создают новые правила адаптации. Snapshot не хранит числовое lastUpdated; после restore оно равно текущему Domain clock. Read DTO immutable, mutable driver rows не возвращать.

## 4. Lifecycle, restore и деградация

### Запуск/завершение

1. Main получает single-instance lock для профиля до открытия БД. Запускает worker на стадии bootstrap до старта Character ticks, параллельно создаёт окно. Первый пользовательский ввод, требующий Character, немедленно завершает ожидание restore и запускает defaults в volatile mode; ввод не ждёт storage.
2. Worker открывает локальный userData, выполняет `quick_check`, проверку версии/журнала, миграции и `foreign_key_check`, закрывает старые sessions, читает snapshot. До этого запись запрещена. Startup deadline — 10 s; при превышении немедленно запустить volatile runtime, worker завершить асинхронно с ожиданием exit перед любым повторным открытием БД. Поздний startup response не применяет state.
3. Application применяет валидный snapshot один раз до первых изменяющих Character stimuli/ticks, затем запускает Brain. Если ранний ввод уже запустил локальный runtime, текущая сессия остаётся volatile, worker закрывается, поздний restore запрещён. Приложение показывает нейтральный статус; повторная попытка — следующий запуск, без скрытого merge свежего и сохранённого state.
4. После readiness — semantic writes и checkpoint не чаще раза в 5 s при dirty state, latest-only. Штатный shutdown закрывает приём новых writes, отменяет provider/activity callbacks, сохраняет последний snapshot, закрывает session и connection, ждёт worker exit. Общий grace deadline 7 s; при истечении — завершение worker, никакого обещания сохранения неподтверждённых данных. Crash может потерять последний checkpoint/неподтверждённую пару, но не требует runtime для recovery WAL.

### Restore snapshot

Application мигрирует только известные версии чистыми функциями. До #123 действует v1; rollout [Character §6](CHARACTER_ENGINE.md#6-авторский-профиль-wisp-revision-2-gate-122) вводит envelope v2 без SQLite DDL migration. Единственный legacy input — exact v1/presetId=shyDreamGirl: shape, finite/ranges, preferences и Domain invariants сначала проверяются по неизменным revision1 caps, не по новым defaults. Legacy validator descriptor хранит только необходимые старые caps, не вторую активную identity. Unknown version/id/revision, лишние поля или invalid state не угадывать/не clamp.

V1→v2 сохраняет Needs, Relationship, Intimacy (включая consent/loveUnlocked) и **все** валидные preferences с value/confidence/samples; заменяет presetId/cardRevision и только currentAxes на base новой карточки. Накопленный offset axes не переносится: это динамика прежнего архетипа без отдельного доказательства намерения пользователя; перенос мог бы восстановить shy core вопреки смене identity. Подтверждённые пользовательские знания/предпочтения не являются этим offset. Messages, facts, episodes, items, receipts, topic и summary rows не переписываются/не переизвлекаются; consent не создаётся заново. Новая карточка не получает унаследованных authored hobbies.

V2 принимает только curiousStubbornGirl/cardRevision=2 и восстанавливает currentAxes относительно её caps. Из immutable preset создаётся state; накладываются только разрешённые dynamic поля. Runtime timers/cooldowns/Activity/quiet/quietSupport/FSM строятся заново, tone пересчитывает Character; lastUpdated=current clock, без offline decay/replay stimuli. Успешная чистая миграция идемпотентна: штатный checkpoint атомарно сохраняет v2, последующие restore не сбрасывают его axes. Migration оставляет checkpoint dirty: saved signature новой projection устанавливается только после успешного save, не сразу после restore. До подтверждённого checkpoint на диске остаётся целый v1; при crash migration повторяется без двойных effects. Запись v2 не поддерживает downgrade к старому клиенту.

Пустой snapshot → defaults и обычный checkpoint. Corrupt/unsupported snapshot → defaults и characterRestore status; исходная строка остаётся неперезаписываемой до успешного явного reset или поддерживающей версии. Остальные валидные таблицы доступны; ошибка restore не объявляет всю БД повреждённой. Migration/write failure сохраняет действующую деградацию memory lifecycle; локальный runtime работает, ложного сохранения нет.

### Ошибка БД/capability

Corrupt SQLite/NOTADB, неуспешная migration, future schema, read-only/userData недоступен, disk full или worker failure: rollback где возможно, остановка durable writes и `MemoryStatusDTO.mode=volatile`. `busy` одной операции допускает отказ без закрытия исправной БД. При системной деградации текущая runtime-сессия продолжает работу с ограниченным volatile dialogue context и живым CharacterState; durable backlog не копится и не проигрывается скрыто позже.

Исходный файл и WAL/SHM не удалять, не переименовывать отдельно и не заменять пустой БД. Нет автоматического quarantine/export/backup с незаданным retention. Recovery — поддерживающая версия/исправление условий и новый запуск; для повреждённой БД, которую нельзя открыть, reset возвращает failure. Ручное восстановление/удаление файлов и recovery UI — отдельная задача. Никогда не трактовать ошибку чтения как пустую подтверждённую память.

## 5. История, подбор и AI context

Хранилище не вызывает provider и не знает token budgets. `getRecent` выбирает последние N по sequence, возвращает oldest-first. Application builder использует `ChatContextLimits`/`DEFAULT_CHAT_CONTEXT_LIMITS`: 20 сообщений, 8000 UTF-16 units суммарно, user ≤240 и assistant ≤2000 на сообщение. Оставить непрерывный суффикс целых user/assistant пар без усечения текста; при переполнении убрать старейшие пары, неполная/некорректная последняя пара не допускает подмешивания более старых. Историю в БД не менять. `assistant` отображается в provider role `wisp`; текущий userMessage передаётся отдельно, не добавляется второй раз. Базовый persistent dialogue context подключается к локальному Mock; network v1 использует те же bounds для volatile завершённых пар из [AI contract](AI_PROVIDER_CONTRACT.md#контекст-reset-и-lifecycle). Network startup hydration не подключается; wire finite caps и provider suffix selection описаны в общем API-контракте. Явные знания и bounded recall для memory-capable режима описаны в §9, сетевые данные — в [Memory wire contract](../../../docs/contracts/BACKEND_MEMORY_CONTRACT.md). Dialogue reset/reload очищает runtime context по AI contract, **не удаляет БД**. Persistent hydration Mock выполняется один раз на Main startup; после dialogue reset старые сообщения не подмешиваются снова в текущую conversation. Новые завершённые turn продолжают сохраняться в storage session этого запуска. При read/write failure система продолжает работу с bounded runtime context, status/diagnostic не выдаёт volatile данные за сохранённые. В базовом режиме этого раздела facts/эпизоды/summaries не участвуют в context; расширенный подбор описан в §9. Storage и recall не влияют на Character напрямую.

## 6. Полный reset и защита от поздних записей

Полный memory reset — отдельный `ClearMemoryUseCase`; `DialogueCommandDTO.type=reset` остаётся reset разговора. Реализованные [ClearMemoryCommandDTO/ResultDTO](../../src/shared/ipc-contracts.ts) проходят typed `window.wispAPI.clearMemory`, Main handler, Preload и exact-shape validation. Статус отдаётся через typed window.wispAPI.getMemoryStatus() без аргументов. Sender проверяется как у dialogue; streamId/requestId non-empty до 128 units, sequence positive safe integer с отдельным счётчиком на Brain stream, неизвестные поля запрещены. Malformed/untrusted input отклоняется до use case; неверный stream или устаревшая sequence возвращает failed/stale. Внутренние invalid_data/conflict проецируются в io_error, без payload ошибки. В существующей панели «Память» доступны статус и полная очистка с явным подтверждением; отдельного Settings окна нет.

Read-only `readMemoryFacts({streamId})` возвращает только key/value пяти registry facts (§9): bounded `list(100)` до allowlist-фильтрации, значения по действующим lengths/enums, максимум пять уникальных ключей. Storage/source IDs, snapshot и путь БД не передаются. Application проверяет phase/generation после await, Main — текущий stream; один unsettled read на lifetime, без фонового retry. UI различает initializing/volatile/error и успешный пустой результат; «Не сохранено» только после success. Исправление — показ поддерживаемой RU/EN фразы для ручной отправки в чат, без автоматического provider call или optimistic storage receipt. Stream/conversation/reset инвалидируют прочитанные значения и формы; результат очистки признаётся только по `cleared`, неизвестный исход повторяется с прежней identity действующего stream.

1. Application закрывает admission persistence-producing turns/games/checkpoints, отменяет активные owners/диалог логически; повышает memory generation. Каждый async callback хранит generation начала и проверяет её **после каждого await и перед side effect**; текущую generation нельзя присваивать старому result задним числом.
2. `IClearMemoryStore.clearUserMemory(nextContext)` — барьер в той же worker queue. Более ранние writes закончатся до него и будут удалены; последующие со старой generation отклоняются как `stale`. Worker принимает новую generation до транзакции и не откатывает её при SQL rollback. Параллельные reset сериализуются; идентичный повтор streamId/sequence/requestId присоединяется к текущему результату, не удаляет новую память второй раз. Последние 100 receipts хранятся в Main; после eviction high-water sequence всё равно отклоняет старую команду как stale. Повтор использует ту же тройку, новая пользовательская команда — новый requestId и sequence; replacement stream инвалидирует старые команды.
3. Одна транзакция удаляет `user_facts`, `game_episodes`, `messages`, `conversation_sessions`, `character_state`. Схема, schema_migrations, user_version, файл, immutable identity/config и appearance/behavior settings сохраняются.
4. Только после commit Application очищает history/facts/snapshot caches, заменяет динамический CharacterState defaults (включая отношения, intimacy, preferences/axes, Needs), сбрасывает старые runtime cooldowns/owners и создаёт новый app_run_id для памяти. После этого возвращает `cleared` и открывает admission. Следующий checkpoint пишет только новый state.
5. При rollback — failure, прежние durable записи и CharacterState сохраняются, admission возобновляется в новой generation; старые async results всё равно недействительны. Потеря worker/ack во время reset → `unavailable`, остановка persistence до restart; нельзя сообщать success по одному истёкшему таймеру или восстанавливать отменённые операции. Startup читает фактически закоммиченное состояние.

Reset удаляет логическую локальную память, не обещает forensic erasure страниц/WAL/OS backup и не удаляет серверные копии. Volatile fallback при существующей недоступной БД не имеет права сообщать `cleared`: без durable commit старые данные могли бы вернуться после restart. Политика удаления серверных данных — отдельный контракт.

## 7. Нецели и gates

Базовые persistence/history и расширенный recall разделены в §5 и §9; адаптация принадлежит Character. Embeddings/vector DB, FTS, cloud sync, server memory, многопрофильность и graphic assets остаются вне MVP. Архитектурные границы зафиксированы в спецификациях соответствующих модулей.

## 8. Integration scope и платформенная приёмка

Для интеграции требуется отдельное согласование `package.json`/`package-lock.json` для [одобренных exact versions](../adr/ADR-016-local-memory-sqlite.md#dependency-review), `vite.config.ts` для bundled worker entry и externalization driver/Node builtins. Исходник/transport worker — `frontend/src/infrastructure/`, output — существующий `dist-electron/`. В electron-builder проверить `files`, упаковку runtime JS/native binary, `asarUnpack` и packaged worker path; менять при необходимости только существующую секцию `package.json`. Новый packager, ORM, rebuild tooling, scripts и расширение targets этим разрешением не предусмотрены. Windows-first gate: Electron 43.4.1, win32-x64, загрузка addon из worker в dev и предоставленном packaged portable, `sqlite_version() = 3.53.4`. Проверить userData с пробелами/кириллицей, offline startup/restart, миграции/reset; при DB lock на 5 s drag/input/Brain ticks продолжаются, очередь bounded. Зафиксировать actual версии, artifact и размер поставки. Подготовка artifact — отдельный packaging scope; `npm run build` запрещён. Host Node/Vitest и более новые `@types/node` не доказывают совместимость с Electron runtime. Linux Wayland/X11 и macOS сохраняют тот же контракт и graceful native-load/capability fallback из §4; непроверенные платформы отмечать NOT RUN. На машине пользователя не скачивать и не собирать addon автоматически; наличие arm64 prebuild не расширяет текущую Windows x64 цель.

<a id="9-p15-a02-явные-знания-и-простой-recall"></a>
## 9. Явные знания и простой recall

Типы — [memory-knowledge.interface.ts](../../src/application/ports/memory-knowledge.interface.ts). Application разделяет source validation, repository writes, recall selection и provider-context projection. Новой SQLite migration нет: `user_facts`, `messages`, `game_episodes` и snapshot v1 достаточны. Additive `IGameEpisodeReader` читает 1–20 эпизодов, newest-first по приватному SQLite rowid; семантика записи сохраняется.

### Что сохраняется и откуда известно

| Категория | Семантика MVP |
|---|---|
| Явный факт | Буквальное утверждение пользователя из registry ниже; source — ID сохранённой user-реплики, не ответ модели |
| Исправление | Новое подтверждённое значение того же key; последняя принятая операция заменяет value/source, сохраняет fact id/createdAt; старое утверждение остаётся в исходной истории |
| Эпизод | Завершённая пара исходного диалога либо реальный terminal курсорной игры; не сгенерированное summary |
| Пожелание | «Отвечай кратко» действует в текущем диалоге; только явно устойчивый вариант registry становится user preference, не приказом изменить Character axes |
| Временная роль | «Сегодня будь пиратом», цитата, гипотеза, пересказ чужой речи; текущий dialogue context без persistent fact и adaptation evidence |

Registry конечный: пять provider scalar keys и два локальных ключа (§9.1 Character), один текущий value на key. `display_name`/`preferred_address` до 80 UTF-16 units, `favorite_topic` до 120; reply_style — `brief`/`detailed`, cursor_game/explore/social_bid — `like`/`dislike`. Извлечение не создаёт диагнозы, политические взгляды, credentials, обещания/напоминания или произвольные ключи. Такие сообщения могут остаться в истории по §2, но не превращаются в структурированные знания автоматически.

Пять provider keys остаются текущей wire projection. Реализованный local-only registry для `user.explore`/`user.social_bid` задаёт [Character §9.1](CHARACTER_ENGINE.md#91-char-a01-следующий-локальный-набор-предпочтений); он не расширяет сетевой allowlist. Локальные facts исключаются до ограничения пяти facts, распознанные пары исключаются из recalled episodes. Независимое расширение событий/шуток — §10.

### Source validation и registry

LLM может предложить до трёх кандидатов в том же response, без второго вызова. Приём выполняет локальный детерминированный recognizer: trim + NFC + case-insensitive сравнение служебных слов; исходные регистр/value сохраняются, значение — буквальный захват исходного текста. Допускается один необязательный префикс `Запомни: `/`Remember: ` либо `Исправление: `/`Correction: ` и одна завершающая точка. Далее **вся** реплика должна соответствовать одной строке таблицы, без второй фразы/условия/отрицания/кавычек. Для имени/обращения допустимы Unicode letters, пробел, дефис; тема также digits/апостроф. Не угадывать склонения и синонимы.

| Key | Полные принимаемые формы RU / EN | Значение |
|---|---|---|
| `user.display_name` | `Меня зовут X` / `My name is X` | X |
| `user.preferred_address` | `Называй меня X` / `Call me X` | X |
| `user.favorite_topic` | `Моя любимая тема — X` / `My favorite topic is X` | X |
| `user.reply_style` | `Я предпочитаю короткие ответы`, `Всегда отвечай кратко` / `I prefer short replies`, `Always keep replies brief` | brief |
| `user.reply_style` | `Я предпочитаю подробные ответы`, `Всегда отвечай подробно` / `I prefer detailed replies`, `Always give detailed replies` | detailed |
| `user.cursor_game` | `Мне нравится игра с курсором` / `I like the cursor game` | like |
| `user.cursor_game` | `Мне не нравится игра с курсором` / `I dislike the cursor game` | dislike |

`evidenceQuote` должен побуквенно совпасть с текущим trim user text; key/value кандидата должны совпасть с локально распознанным результатом. Неподдерживаемая свободная формулировка не сохраняется автоматически: это сознательно узкий первый extraction, без ложной уверенности модели. Если модель пропустила кандидат, Application всё равно может получить тот же единственный факт recognizer-ом из текущего user text: сохранение явной поддержанной формы не зависит от качества extraction LLM. Два кандидата одного key отбрасываются; локальный recognizer остаётся единственным решающим источником. Confidence принятого факта — 1 (подтверждена буквальная нормализация, не объективная истинность утверждения).

Сначала terminal turn показывается по текущему dialogue lifecycle; затем `appendTurn` подтверждает обе реплики. Только после успешного commit и проверки текущей generation разрешён `upsert` с точным persisted user ID. Отказ записи пары запрещает fact write; fact failure не отменяет показанный reply, не запускает LLM retry и отражается существующим memory status. Fallback/Mock также допускает локальное извлечение из сохранённого user text, но provider-generated fallback никогда не источник. На startup историю не переизвлекать и старые callbacks не проигрывать. После reset/dispose/current-generation change ни факт, ни evidence не принимается.

### Подбор контекста

В memory-capable режиме один admission собирает context с общим **200 ms** бюджетом чтения в пределах dialogue deadline. `facts.list(100)`, `history.getRecent(100)`, `gameReader.getRecent(20)`; нет полного scan всей БД/ожидания больше budget. Ошибка/таймаут любого read даёт пустой memory context на этот turn и безопасную storage diagnostic; поздний read не меняет уже отправленное и не пишет данные. Между turn нет polling/summary/LLM background jobs. Character snapshot и bounded volatile suffix §5 доступны независимо от storage.

- **Always include:** актуальное авторское ядро/needs/отношения из CharacterSnapshot и все найденные пять registry facts с валидным источником/значением; неизвестные keys не передавать. Facts не зависят от совпадения вопроса. Character learned `activity.cursor_game` включается отдельно при confidence ≥0.5; user preference не выдаётся за вкус персонажа.
- Кандидаты dialogue: только полные соседние user→assistant пары одной session из последних 100 сообщений; исключить IDs текущего volatile context. Пару с любой распознаваемой registry-фразой исключить целиком: актуальные structured facts — единственный источник этих значений, старое исправленное значение не возвращается через episode. Также не подбирать пары с явным префиксом `Забудь`/`Forget`/`Сегодня будь`/`Today act as`.
- Query и pair text: NFC, lowercase, Unicode letter/digit tokens длиной ≥2; score — число различных query tokens в объединении user/assistant tokens. Только score >0, сортировка score descending, затем более поздняя insertion position. Ни RNG, ни embeddings, ни lemmatizer. Берутся максимум две пары; user ≤240, assistant обрезается до400 UTF-16 без разрыва surrogate pair.
- При query token с префиксом `игр`, `курсор`, `пойм`, `промах`, `ловил` либо `game`, `cursor`, `catch`, `caught`, `miss`, `play` одно из двух мест резервируется последнему сохранённому игровому эпизоду; остальное — лучший dialogue match. Outcome/длительность/время передаются буквально, без предположения об участии/удовольствии пользователя. Если игры нет, остаётся обычный dialogue подбор.
- Если последний storage-valid игровой эпизод имеет executedMs>60000 и не помещается в wire range, пропустить только этот эпизод без clamp/изменения SQLite и без подстановки более старой игры; оба места вновь доступны dialogue recall, facts сохраняются, storage corruption/ошибка всего chat не объявляется.
- Итого: ≤5 facts, ≤2 episodes (из них ≤1 game), ≤1 character preference; до2400 UTF-16 units всех memory text values (включая timestamps), общий HTTP byte cap проверяется отдельно. Не вмещающиеся episodes удаляются с конца ranking; ключевые facts/identity не вытесняются. Будущий индекс заменяет источник recall кандидатов за портом, не источник исходных записей.

Это bounded recall последних 50 разговорных пар/20 игр, а не обещание поиска всей истории. Старые structured facts доступны независимо от давности. Индекс/более глубокое чтение вводится следующим gate при измеренных пропусках; текущие source records не обрезаются по provider budget.

### Network mode и удаление

Provider DTO получает memoryContext по умолчанию; сетевой payload — [BACKEND_MEMORY_CONTRACT](../../../docs/contracts/BACKEND_MEMORY_CONTRACT.md). Единый `/v1/chat` отправляет bounded memory вместе с карточкой и effectPolicy; смены модели или второго запроса при ошибке нет. После restart recall вновь читает сохранённое; после dialogue reset в новой conversation structured facts/релевантные episodes доступны по следующему явному user send, но не подмешиваются без запроса. Полный memory reset очищает источники по §6 и защищает поздние callbacks.

Исправление заменяет current fact, но не стирает исходный transcript. Команда забывания отдельного факта/редактирование истории не вводится: не обещать такого удаления в ответе LLM; полноценный full reset выполняется через ClearMemoryUseCase. `removeByKey` остаётся низкоуровневым портом для доверенного use case, не публичной семантикой «забыть навсегда». Retention server/cache/provider и отсутствие server-delete endpoint — [backend §6](../../../docs/contracts/BACKEND_API_CONTRACT.md#6-данные-сроки-хранения-и-удаление), с явным составом памяти из отдельного контракта.

<a id="10-mem-a03-важные-события-и-общие-шутки-planned"></a>
## 10. Важные события и общие шутки (planned)

Этот раздел описывает плановое расширение поверх §9. Локальная schema2 не расширяет wire allowlist из пяти facts. Передача новых категорий потребует отдельного завершённого slice в едином API v1. Character snapshot не меняется; записи ниже не дают adaptation evidence, consent или числовых rewards.

### 10.1. Допустимые знания и evidence

| Категория | Смысл и единственный авторизующий источник |
|---|---|
| `important_event` | Завершённое событие из жизни пользователя, которое он явно выбрал сохранить; формулировка хранится как его утверждение, не независимая проверка события |
| `shared_joke` | Явно подтверждённая пользователем общая фраза/шутка; текст допустим как цитата шутки, но не как буквальный факт о мире/отношениях |

Первый slice использует локальную карточку памяти в существующей поверхности диалога: пользователь сам выбирает «Сохранить событие»/«Сохранить шутку» у завершённой пары и подтверждает редактируемый текст. Это отдельная typed IPC команда, не интерпретация фразы LLM. Main проверяет sender/stream/sequence; Application проверяет source pair в SQLite, generation и явное подтверждение. До commit карточка не показывает «сохранено». Кнопки исправить/отозвать/удалить находятся у сохранённой карточки; список читается страницами ≤20. Конкретная стилизация не задаётся архитектурой; файловое редактирование и новый Settings window не нужны.

Запись содержит стабильный локальный ID, category, одну текущую revision, label 1–80, text 1–400 UTF-16 units, optional occurredOn (календарная дата `YYYY-MM-DD`, **только введённая пользователем**), confirmedAt UTC и monotonically increasing insertion order. Label/text — plain text; credentials, диагнозы/политические профили как отдельные категории, scalar registry facts, будущие обещания/сроки/повторы не допускаются. Граница шутки фиксирует, что её цитата не участвует в fact recognizer. Нет автоматического inference значимости, даты, участников, истинности или чувств пользователя.

Evidence — exact подтверждённые label/text/date/category текущей revision + ID пользовательской локальной команды и ссылка на исходную persisted пару. Модельный ответ, заголовок окна, lore, непоказанный/fallback provider result и неподтверждённая цитата не авторизуют запись. Пользователь может превратить выбранный текст шутки в память только отдельным явным подтверждением; модель не может подтвердить за него. Создание после restart читает актуальный source через repository, не доверяет Renderer копии. Невалидная/несохранённая/подавленная пара → отказ создания; изменение/повторное подтверждение существующей карточки проверяет её ID/revision и допускает собственный suppressed source. Никаких startup re-extraction, LLM extraction/summary calls или автоматического извлечения из старой истории.

### 10.2. Исправление, актуальность и удаление

- Исправление требует ID и expected revision; одна worker transaction заменяет current text/evidence/index и увеличивает revision. Revision mismatch → conflict; «последним пришёл HTTP» не правило разрешения. Старый текст revision не сохраняется вторым актуальным знанием или журналом. Все когда-либо связанные source pair IDs сохраняются без копии текста для suppression.
- «Отозвать» атомарно меняет active на withdrawn и убирает index: знание не попадает ни в какой AI context, но остаётся в локальной карточке до исправления/повторного явного подтверждения или удаления. Возраст не превращает событие в ложное: активные записи без TTL; occurredOn отличается от confirmedAt, отсутствие даты не заменяется временем подтверждения. Шутка означает известный общий контекст, не постоянную готовность пользователя шутить.
- «Удалить запись» удаляет current payload/evidence/index. Остаются только opaque IDs ранее связанных source pairs в suppression и receipt операции; по ним нельзя восстановить текст записи. Исходный transcript не стирается: интерфейс явно пишет «Удалить из памяти; история диалога сохранится». Full reset §6 удаляет и историю, и новые таблицы. Выборочное редактирование/удаление transcript — отдельный scope, без ложного обещания forensic erasure.
- Source pairs активной, исправленной, отозванной или удалённой карточки исключены из обычного recent dialogue recall и volatile network messages. Это исключает competing старую revision и возврат удалённой памяти через исходный текст. На новую future user-реплику ограничение по старому ID не переносится; повторное сохранение нового утверждения требует новой явной команды.
- После принятия mutation закрыть admission памяти, инвалидировать generation/abort pending chat и events; выполнить mutation барьером в той же worker queue. После commit очистить связанные volatile pairs, cached recall и previousInitiative, затем открыть admission. После rollback прежняя запись сохраняется, но старые callbacks уже invalid. При потере ack outcome неизвестен: не показывать success, следующий restart читает фактический commit. Локальные FSM/input продолжаются.
- Результат текущего cloud запроса не может откатить correction/withdraw/delete; физический отзыв данных у провайдера и server cache не обещается. Правила [wire §6](../../../docs/contracts/BACKEND_MEMORY_CONTRACT.md#6-mem-a03-planned-расширение-событий-и-шуток) обязательны и для локальной карточки.

### 10.3. Хранение и миграция

Один существующий SQLite worker/драйвер; новый движок/зависимость не нужен. Additive migration2 создаёт `memory_items` (current payload/status/revision/order), `memory_item_sources` (item ID и source pair IDs), `memory_item_terms` (производные token/item ID), `memory_suppressed_pairs` и `memory_mutation_receipts` (command ID, kind, item ID, revision/result и digest аргументов, без исходного текста). FK/index constraints обеспечивают целую пару, уникальные token/item и receipt ID; payload/source/evidence/index меняются одной транзакцией. Receipt повтор с тем же digest возвращает прежний outcome, с другим — conflict, без второго write. Для receipt без TTL не обещать очистку до full reset.

Миграция не извлекает знания из `messages`, не переписывает schema1/snapshot и сохраняет все исходные rows. `user_version`/журнал повышаются лишь после commit; rollback оставляет schema1. Startup/future version/corruption/failure semantics — §3–4; откат приложения на старую версию безопасно отказывает future schema, не удаляет новые таблицы. Full reset §6 расширяется на все пять новых таблиц в той же транзакции, без изменения версии схемы. Удаление item сохраняет suppression source IDs, не dangling FK на item; удаление всех источников full reset удаляет suppression тоже.

Текстовые токены — NFC/lowercase, Unicode letters/digits длиной 2–64; не более 64 различных токенов label+text на item в порядке появления. Детерминированный индекс `(token, item insertion order DESC, item ID)` обычными SQLite таблицами, без FTS/embeddings. Производный индекс можно транзакционно перестроить из current active items; потеря индекса не удаляет source. Состояние rebuild не выдаётся за пустую память: на turn — degraded recall. Rebuild выполняется worker порциями ≤100 items с сохранением cursor, без нового scheduler/LLM и без задержки локального runtime сверх §4 startup deadline.

Application ports отдельно задают typed confirm/update/withdraw/delete, paged list и candidate search; Infrastructure скрывает SQL и порядок. Новые порты/IPC DTO/guards объявляются **до реализации** первого slice; provider context не расширяется без согласованной wire projection обеих сторон. Имена таблиц и local IDs не входят в wire. Ограничение §3 read limit ≤100 действует также здесь; нет SELECT всей истории ради одного запроса.

### 10.4. Bounded recall длительной истории

Внутри общего 200ms deadline §9 сначала получить текущие scalar facts и не более 8 различных query tokens (тот же tokenizer). По каждому token indexed lookup читает ≤12 newest active item IDs: всего ≤96 postings, fetch ≤96 current payloads с повторной проверкой active/revision. Это ищет сохранённые значимые записи независимо от их положения в последних 100 messages; произвольная старая разговорная пара не становится knowledge сама. При частом одинаковом token старый item может не попасть в cap — это явное ограничение, не обещание semantic search.

Score — число совпавших различных query tokens в label+text, только >0; затем больше label matches, затем более поздняя revision confirmation order, затем item ID по codepoint. Alias/synonyms, RNG, sentiment importance и embeddings не добавляются. В общем лимите **двух** episodes при game query сохраняется одно место последней допустимой игре §9; оставшиеся места занимают ranked items, затем обычные ranked recent pairs. Отобранная карточка не дублируется своим transcript; suppressed pairs исключаются до selection независимо от provider версии. При равном вводе/БД результат детерминирован.

Всегда сначала текущие wire facts/Character projection, затем episodes; memory cap остаётся 2400 UTF-16 string values и 32KiB всего HTTP. Drop episodes с конца ranking, без усечения текущего подтверждённого text и без потери ядра/facts. Нулевой match → только разрешённый baseline context; не угадывать память. Любой storage error/timeout/stale → безопасная пустая memory projection текущего turn, без позднего send/write и без неограниченной очереди. В API v1 новые категории не отправляются; после их фильтрации baseline episode slots заполняются допустимыми §9 кандидатами.

### 10.5. Проверяемые сценарии качества

| Fixture / действие | Ожидаемый детерминированный результат |
|---|---|
| Подтвердить important_event «Защита диплома», text «Защитил диплом по робототехнике», occurredOn `2026-10-10`; добавить 1000 поздних пар, restart; query «диплом робототехнике» | Та же актуальная карточка среди ≤2 episodes; source не обязан быть в последних 100 messages; дата не заменяется startup time |
| Подтвердить shared_joke label «Чайный капитан»; restart; query «чайный капитан» | Возвращается category shared_joke, не факт профессии/звания; шутка не увеличивает affection/preferences |
| Ещё три изолированные карточки: important_event «Первый марафон», important_event «Поездка на Байкал», shared_joke «Картофельный адмирал»; 1000 поздних пар, restart; запросы «марафон», «байкал», «картофельный адмирал» | Для каждого запроса включена соответствующая карточка; label/text других карточек не содержит токены этого запроса |
| Исправить событие: «Защитил диплом по математике»; query «диплом» | Только новая revision; старый текст отсутствует в episode и передаваемых recent messages; старое слово «робототехнике» больше не индексирует item |
| Отозвать/удалить карточку, restart, тот же query; завершить старый provider callback | Карточки нет в context; source пары suppressed; callback не восстанавливает запись. Full reset затем удаляет payload, receipt, suppression и transcript |
| Модель придумала событие; цитата/роль без подтверждения; unmatched query | Ноль new items; отсутствующий match не заменяется случайной карточкой |
| >96 совпадений, equal score, emoji у лимита; migration/write/timeout failures | Соблюдены postings/payload/text/byte caps и стабильные ties; failure не объявляет durable success, старые источники не теряются |

Эти fixtures проверяют selected context, а не точную недетерминированную фразу LLM. Приёмка long-history набора: 100% включение ожидаемого item для пяти фиксированных уникальных query/labels после 1000 пар, 0 withdrawn/deleted/старых revisions, ≤96 payloads/turn. Embeddings рассматриваются новым gate только после измеренных lexical misses на сохранённом наборе; текущая цена — отсутствие синонимов и bounded fan-out.

<a id="12-ctx-a01-производная-summary"></a>
## 12. Производная summary

Спецификация производного summary разговоров;
передача/доверие/budgets — [Context data](../../../docs/contracts/CONTEXT_DATA_CONTRACT.md).
Summary — неподтверждённый пересказ, не knowledge item, transcript, факт или adaptation.
Application владеет selection/generation/revalidation; Infrastructure — локальным cache
и backend transport; Main — DI/typed IPC; Renderer — явной командой/безопасным статусом.
Новые Domain engine, SQLite migration, server storage и scheduler не требуются.

### 12.1. Источники и явный trigger

Durable признак допустимого successful source и suppression:
из §10; без них нельзя после restart доказать, что persisted pair не fallback.
Schema1 → summary недоступна, обычная память/chat работают. Расширение wire memory не требуется.
Исходники — только соседние completed user→assistant пары одной сохранённой session,
подтверждённые worker append, с допустимой provenance; suppressed/withdrawn/deleted
source, непоказанный результат, event speech и lore никогда не источник.

Команда «Составить краткое содержание» в существующем диалоге открывает preview
диапазона и отдельное подтверждение отправки этих пар backend/provider. Application
читает ≤100 последних messages за ≤200ms; из них выбирает самый поздний непрерывный
run 4–8 допустимых пар одной session вне recent window по bounds §5. Невалидная пара
разрывает run; массив не склеивает пропуски. Среди suffixes run выбирается самый
длинный помещающийся в wire caps; тексты не обрезаются. Нет 4 подходящих старых пар → генерации нет.
Пары с scalar registry forms или префиксами «Исправление:»/«Correction:», «Забудь»/
«Forget» исключаются: исправленные значения не возвращаются через пересказ.

Preview хранит source IDs, их content revisions и snapshot текущих scalar facts;
TTL120s по monotonic clock, current stream/memory generation. Source revision — SHA-256 exact UTF-8 JSON
массива [userID, assistantID, sessionID, userText, assistantText, eligibility]; явные
mutable revisions, если появятся, также включаются. Hash не подтверждает истинность.
Confirm повторно читает exact IDs/provenance/suppression/facts и сравнивает snapshot;
изменение → отказ stale без HTTP. Backend получает только тексты пар, не IDs/digests.

Максимум одна принятая попытка на локальный профиль за rolling24h по persisted времени,
без очереди/фоновых retries; clock rollback не сокращает ожидание. До fetch атомарно
записать receipt: commandId, requestId, source digest, admittedAt, generatorVersion=1,
без текстов. Write failure запрещает fetch; restart не сбрасывает receipt. Идентичный
повтор command присоединяется к pending/result без нового inference; persisted receipt
того же commandId не разрешает повтор и после24h. Тот же source digest/
generatorVersion при валидном cache возвращает cache даже с новым commandId; другой payload
с тем же ID — conflict. После ошибки/timeout/unknown outcome попытка тоже израсходована;
повтор возможен только новым явным подтверждением после24h. Это локальный guard,
не аккаунтная квота/гарантия денежного лимита при удалении userData или смене часов.
Chat никогда не запускает summary inference, включая cache miss и startup.

### 12.2. Disposable cache и актуальность

Один cache formatVersion1 по пути path.join(userData, 'memory', 'summary-cache.json'),
вне SQLite, ≤32KiB: одна summary≤1200 UTF-16, 4–8 source ID/revision tuples/session,
coverage (точный список пар), digest scalar facts, locale, generatorVersion и receipt.
Нет копии исходных текстов. Сохраняет Infrastructure через serial queue, temporary file
и atomic replace, без нового package; failed write не означает «сохранено».
Неизвестный format/corrupt файл → summary отключена до явной очистки cache, не автоматический
сброс receipt/новый платный вызов; исходная SQLite не повреждена. Схема SQLite
не меняется; cache можно удалить без потери источников, старый binary его игнорирует.

Перед save и каждым включением в chat (также после restart) перечитать exact source
IDs, eligibility, suppression и scalar facts в общем200ms budget; все hashes/locale/
generatorVersion должны совпасть. Missing/changed/suppressed/timeout → cache непригоден,
без late write/send. Проверяется ≤16 source messages, не scan старой истории.
После 1000 новых пар summary остаётся доступна по этим IDs, если источники актуальны.
Проверка и захват chat snapshot сериализованы с memory mutations; новый source change
между read и dispatch инвалидирует capture. Late read не обогащает отправленный запрос.

### 12.3. Invalidation и удаление

| Событие | Действие |
|---|---|
| Source correction/delete; scalar fact correction/removal; item confirm/update/withdraw/delete | Закрыть admission summary, invalidate generation/abort; очистить производный text/coverage до нового capture; §10 suppression и commit barrier сохраняются. Receipt без текстов остаётся до24h. Rollback не возвращает старые callbacks. |
| Full memory reset | Сначала invalidate/abort и закрыть admission, затем удалить cache/temporary files/receipt вместе с reset workflow §6. До подтверждённой очистки success не показывать; при ошибке summary disabled. Source reset всё равно исключает старые IDs; поздний writer не создаёт файл заново. |
| Dialogue reset / Renderer reload | Abort pending generation/preview, очистить volatile selection; durable cache/receipt остаются. Только следующий явный send может заново валидировать и использовать summary. |
| Restart | Никаких генераций/replay; cache проходит bounds/source validation, receipt учитывается. Незавершённая попытка не повторяется. |
| Dispose | Abort/invalid generation, закрыть queue; pending save после границы запрещён. Ранее committed cache остаётся до следующей валидации. |

Произвольный transcript editor не вводится. Будущий source edit/delete обязан пройти
тот же barrier; file hash не заменяет mutation notification. Для свободной correction,
которую scalar recognizer не понимает, пользователь может явно «Удалить краткое
содержание»: удалить text/coverage, invalidate pending, оставить24h receipt; transcript
и confirmed knowledge не изменяются. UI не обещает забыть источник навсегда.
Удаление полного memory/cache не удаляет уже переданные backend/provider копии;
retention — общий contract. Ошибки/отсутствие cache никогда не блокируют FSM/input/chat.

<a id="13-interaction-a01-краткий-след-касания-87"></a>
## 13. Краткий след касания

Main/Application хранит **один** [PreviousTouchReaction](../../src/application/ports/interaction-appraisal.ts) в RAM, до 10 минут по monotonic clock от публикации. Только действительно опубликованный touch text и фактический action=touch, UTC occurredAt, AI proposal (untrusted), принятое решение/reason и pre-base energy≤30=tired / otherwise rested, comfort≥80=overloaded / otherwise calm. Это объясняет ближайшее «почему?», не доказывает чувства/намерения пользователя. Reply/cause не превращаются в user fact, message, summary source или verified preference. При локальном fallback appraisal=neutral/low/uncertain; effect=rejected/reason=unavailable либо state_changed, suppressed/cooldown при rate gate.

Trace заменяется следующим опубликованным touch. Его копия попадает только в явный `/v1/chat` как previousTouch; не consume-on-read, последующие вопросы до TTL допускаются. Никакого поиска старых touch из chat text. Исходный пользовательский вопрос и текущий snapshot приоритетнее старого trace; prompt честно отделяет состояние тогда от сейчас. Touch без публикации не создаёт trace и не затирает прежний, кроме invalidation.

Restart, dialogue reset/reload, full-memory reset (включая начало generation barrier), dispose и любая memory deletion/correction invalidation очищают trace и pending copies. TTL проверяется при каждой сборке/публикации, не только таймером. После удаления ни pending late response, ни cache не возвращают след в контекст. Нет новых SQLite таблиц/миграций, durable interaction journal или server conversation storage. Изменённый CharacterState сохраняется обычным checkpoint §4; без долговременного trace после restart приложение не обещает помнить причину. Это сознательный scope первого сценария: устойчивое объяснение между запусками требует отдельной задачи/gate.

Обычные chat pairs сохраняются по прежним правилам. AI appraisal не идёт в extraction, recall, подтверждение фактов, axes learning или summary. Backend получает только bounded projection согласно [Events §10](../../../docs/contracts/AI_EVENTS_CONTRACT.md#10-interaction-a01-семантическое-взаимодействие-v1), не local interactionId/generation/monotonic clocks, не история прикосновений.

## 14. Одна подтверждённая тема обычного диалога (#109)

Порты — [interest-thread.interface.ts](../../src/application/ports/interest-thread.interface.ts), локальные команды/представление — [IPC DTO](../../src/shared/ipc-contracts.ts); wire — [Backend Memory §7](../../../docs/contracts/BACKEND_MEMORY_CONTRACT.md#7-одна-тема-обычного-диалога-109). Application владеет eligibility и lifecycle; существующий SQLite worker — единственный источник подтверждённого состояния. Это отдельный singleton внутри памяти, не `important_event`, scalar fact, summary, планировщик, календарь или новая автономная активность. Отдельного LLM extraction/planner нет.

**Создание и consent.** В существующей поверхности «Память» у успешной завершённой пары доступно «Вернуться к теме / Revisit topic»: пользователь выбирает/вводит точную непрерывную цитату своего сообщения (trimmed plain text 1–160 UTF-16), видит её и явно подтверждает сохранение и передачу настроенному AI в обычном разговоре. Main проверяет sender/stream/sequence/generation и текущий conversationId; worker повторно читает смежную user→assistant пару одной session с memory_confirmable=1. До generation barrier confirm ждёт history.whenSettled в bounded200ms, затем заново проверяет stream/conversation/generation и source; показанный memorySource сам по себе не acknowledgment. Только существующая, не находящаяся в suppression и committed пара допустима; свободный пересказ, assistant text, модельное предложение, summary/lore/observation не evidence. Цитата — утверждение пользователя, не доказанный факт или чувствительный профиль; нет вывода диагноза, взглядов, даты/исхода события. Source user text с распознаваемым registry fact/preference (§9) либо командным префиксом забывания/временной роли не допускается: уже применённое extraction/learning задним числом не отменять. Новая панель/настройки не нужны; #69/#93 не меняются. «Сохранено» только после commit. Новый opt-in с новой парой может явно заменить текущую тему через expected ref; implicit overwrite и повторное использование старой suppressed пары запрещены.

**Eligibility и одноразовость.** Одна `unanswered` тема; eligibleAt=confirmedAt+24h, expiresAt=confirmedAt+7×24h по UTC длительностям, без вывода даты события из «сегодня». Это консервативные начальные границы, не измеренное tuning. Только явный поздний user send, который после trim/lowercase и удаления конечных `.!?` равен одному из: `привет`, `доброе утро`, `добрый день`, `добрый вечер`, `как дела`, `давай поболтаем`, `hi`, `hello`, `good morning`, `good afternoon`, `good evening`, `how are you`, `let's chat`. Остальной ввод — no-match, без отвлечения и без расхода попытки. Current UTC раньше confirmedAt → skip; now≥expiresAt → closed. Только явно объявленный IAIProvider.supportsDialogueTopic и статус ready/degraded разрешают follow-up reservation; отсутствие capability (включая текущий Mock) не расходует попытку. Закрытие/открытие UI чата не обязано менять conversationId; новая сессия или restart не являются условием. Никаких событий/autonomy/social/touch/summary consumers.

Один `claim` в worker атомарно проверяет source/ref/generation/eligibility/absence attempt и сохраняет requestId+userMessageId+attemptedAt, увеличивая revision и возвращая именно новый ref, **до** сетевого dispatch. Лимит — одна попытка на подтверждённую тему за весь срок жизни, включая restart. Timeout, crash, потеря ack, dropped optional context, отказ модели спросить и отсутствие пользовательского ответа не возвращают allowance; без подтверждённого claim нет отправки темы. Preflight/summary.capture/recall (включая повтор после drop summary)/claim/capture имеют один абсолютный200ms deadline и один unsettled admission group в пределах15s dialogue deadline: внешний timeout возвращает baseline без memory/summary/topic, после каждого await остаток проверяется до следующей операции. Внутренние таймеры не продлевают общий budget; до settlement старой группы новая не стартует. Перед dispatch и публикацией снова проверяются generation/expiry; если уже отправленная тема истекла/инвалидирована, весь provider response отбрасывается, публикуется безопасный fallback без topic, а не старый ответ без metadata. Поздний read может завершить durable claim, но не отправить тему. Один unsettled read group, без polling/retry. Ошибка storage даёт обычный dialogue без темы и существующую neutral diagnostic; FSM/Motion/input продолжаются.

| Событие | Переход и durable результат |
|---|---|
| Явное confirm/replace новой source pair | Один новый `unanswered`; expected singleton ref/null — CAS, новый threadId; старый payload удалён, suppression старых источников остаётся |
| Committed claim; success/fallback/timeout либо молчание | `unanswered` с необратимо использованной попыткой; публикация не означает, что модель действительно задала вопрос |
| «Ответить по теме / Reply to topic» в существующей поверхности + обычный send | Явный local replyToInterestThread ref; понятная подпись у ввода и отмена выбора. После commit завершённой successful пары → `answered`, text очищается, сохраняется только answer source IDs. Это подтверждение пользовательского ответа, не истинности/полноты его содержания |
| «Не спрашивать / Don't ask again» либо scoped отказ | `closed/declined`, text очищается; standalone кнопка не вызывает provider. При reply binding или последнем показанном topic turn точные trim/lowercase формы `не хочу обсуждать`, `не спрашивай об этом`, `не спрашивай`, `i don't want to discuss this`, `don't ask about this`, `don't ask again` являются локальной командой: mutation barrier, затем neutral notice в существующей Memory surface; provider call и conversation pair не создаются |
| Явное закрытие / expiry / изменение или удаление source | `closed/dismissed`, `closed/expired` или `closed/source_changed`; payload очищается, повтор запрещён |
| Удаление темы / full reset | Удаление singleton payload; suppression/receipts остаются при отдельном delete и удаляются вместе с источниками только full reset §6 |

Свободный ответ без explicit reply binding не классифицируется как `answered` моделью; уже использованная попытка всё равно исключает повторный вопрос. Полученный ответ/отказ не превращается в fact, preference, reward или новое evidence для создания темы. Править тему можно лишь новым явным подтверждением новой актуальной user pair; прежний текст/ответ не становится second active topic. RU пример: «сегодня собеседование» → confirm цитаты → через ≥24h обычное начало «Привет» → один осторожный вопрос о том, как сейчас дела с темой, без утверждения, что собеседование состоялось/успешно; reply binding + «его перенесли» → answered. EN: «I have an interview today» → confirm → later «Hello» → one cautious follow-up; «Don't ask again» → closed. Вопрос не обещает напоминание, память об исходе или будущую инициативу.

**Suppression и atomicity.** Confirm сразу добавляет source pair в существующий memory_suppressed_pairs: она исключается из raw recent/volatile network context, recall и summary (§10.2, §12.3), но точное чтение собственной source темы допускает её собственную suppression. Подавленная чужой памятью/удалением пара не может создать тему. Все когда-либо связанные исходные, предложенные и явно ответные пары остаются suppressed независимо от terminal/delete. CompletedChatTurn.interestThread — доверенная локальная связь: appendTurn одной транзакцией пишет обе реплики, suppression этой пары и, для reply, проверяет ref/source и лишь при memoryConfirmable=true переводит в answered. Для follow_up проверяет совпадение committed requestId/userMessageId/post-claim ref; одна reservation допускает только одну completed pair; произвольный callback не authority. Новое ручное user-сообщение остаётся разрешённым текущим вводом; suppression относится к старым IDs, не к похожим словам. После confirm исходная pair исключается из volatile context; известные до append offer/reply turns также исключаются из fact/learning extraction; source IDs и state не извлекаются из текста LLM. Ошибка append не подтверждает answered; обычный опубликованный reply остаётся по §5.

Любой topic confirm/replace/close/delete, а также card mutation, затрагивающая его source IDs, синхронно закрывает topic admission, повышает memory generation, abort chat/events, очищает volatile copies/previousInitiative/summary, затем выполняет worker barrier. Source correction/withdraw/delete закрывает зависимую тему **в той же транзакции**; card→topic и topic→card sharing одной пары сейчас запрещён suppression, поэтому card-source invalidation — защитный инвариант для future/imported state, не доступный пользовательский сценарий текущего slice; при rollback прежние данные остаются, старый callback уже invalid. Source/expiry repository.read является чистым чтением с sourceValid; terminalization выполняется отдельной close mutation с barrier, а не скрытой записью read. Все semantic transitions/CAS увеличивают revision; claim/reply допустимы только для unanswered. Произвольный transcript editor не вводится; будущий editor обязан вызвать тот же barrier. Dialogue reset/reload отменяет pending/captures/reply binding, но сохраняет singleton/использованную попытку. Restart ничего не переизвлекает и не повторяет; dispose отменяет очередь/callbacks. После удаления ни transcript, ни summary, ни ответ в полёте не восстанавливают тему; повторный explicit opt-in возможен только из новой user pair.

**Preflight и отказ.** receive принимает input один раз и резервирует busy admission token до создания active Turn/provider request. admit выполняет bounded source/expiry maintenance и scoped refusal; собственная mutation может очистить прежний dialogue context и поднять generation, сохраняя только этот pending input token. После acknowledgment допускается rebase только на generation именно этой операции и тот же live token; внешний reset/delete/reload/dispose отменяет token, не возобновляет старый send. Для kind=continue Turn создаётся с новой generation и исходным15s deadline; kind=closed завершает локальную команду без provider/истории, UI показывает закрытие только после commit. При failure нет durable-success notice; тема отключена на текущий admission, локальная жизнь продолжается. prepare никогда сам не выполняет closing mutation внутри уже active Turn.

**Migration и retention.** Additive SQLite migration3 `interest_thread_v3` создаёт `interest_thread` (CHECK singleton, ref/revision/state, одна source pair, text nullable только в terminal, statedAt из user source, confirmation/eligibility/expiry, nullable immutable attempt и answer source IDs) и `interest_thread_receipts` ((kind,commandId) UNIQUE, digest аргументов, ref/outcome без текстов; у kind=turn также userMessageId и assistantMessageId с отдельными UNIQUE indexes, у mutations оба NULL). Все даты/IDs/CAS валидируются по §3; receipts одинаковой команды возвращают исторический outcome без повторной мутации, иной digest → conflict. Исторический receipt не разрешает send/create: нужен свежий singleton/source read. Новая UUID при повторе неопределённого write запрещена. Для appendTurn receipt kind=turn, commandId=requestId: digest включает обе message IDs/payload и topic binding. Lookup по обоим message IDs и requestId выполняется до обычного early-success append, включая unbound вход; reverse association сохраняется после delete/replace без сканирования receipts: identical replay не повторяет переход; другой callback pair того же requestId, иное binding или bound→unbound replay тех же IDs → conflict. Существующая пара без такого receipt не принимает binding задним числом. Для reply первый append проверяет актуальный unanswered ref и увеличивает revision; следующий иной pair со старым ref отвергается. Claim replay не возвращает право повторного dispatch; startup не replay-ит requests. Не менять migrations1/2, исходные messages или snapshot; не извлекать темы при миграции. Summary source reader принимает проверенную schema3 с теми же suppression rules. Rollback сохраняет schema2; старый binary безопасно отказывает future schema.

Активный текст допустим только до expiresAt; очищается отдельной mutation в ближайшем startup/preflight/UI-read use case после expiry (закрытое приложение не выполняет retention job), также немедленно при terminal/delete/replace commit. Хранится максимум одна текущая terminal запись без текста до replace/delete/reset; receipts и opaque suppression/source IDs — до full reset, без копий цитат/ответов. Full reset расширяет одну worker transaction на обе новые таблицы до удаления source messages; ошибки/late acknowledgment — §3–6. Server retention неизменён, физического удаления уже переданного provider content не обещать.

**Приёмка.** Проверить explicit source/quote/consent и отсутствие model-only/summary/registry creation; waiting for source commit; no-match/до24h/7days/capability; first claim/repeated callback/lost ack/restart; successful bound answer, free reply без повторного вопроса, scoped refusal; replacement/CAS и реальный topic delete; защитная source invalidation fixture отдельно от достижимого UI; full reset/dispose/in-flight response; suppression source/offer/answer во всех context paths; read/write/queue failures и rollback миграции2→3. Windows — основная платформа приёмки; macOS/Linux capability fallback, без ОС-веток за platform adapters, платных вызовов и новых ассетов.

## 15. Одна гипотеза бытового предпочтения (#113)

Типы — [memory-beverage.interface.ts](../../src/application/ports/memory-beverage.interface.ts), команды — [IPC](../../src/shared/ipc-contracts.ts), wire — [Backend Memory §8](../../../docs/contracts/BACKEND_MEMORY_CONTRACT.md#8-гипотеза-кофечай-113). Это узкая категория `beverage_preference`, только coffee/tea и максимум одна текущая запись (включая rejected/withdrawn); не registry scalar, topic, generic fact, Character affinity или психологический профиль. Application владеет provenance/validity/ручными решениями и projection; worker — атомарностью. Никаких embeddings, active-app evidence, нового storage subsystem, inference engine, фонового или второго AI-call.

**Proposal и source.** Только успешный обычный chat может вернуть один semantic AI proposal с точной полной trim user-цитатой ≤240 UTF-16; semantic отбор делает AI, строгая проверка формы/quote/current source не доказывает устойчивый вкус. Модель не подтверждает знание. Application держит один непрозрачный RAM offer последней успешно сохранённой, memory_confirmable пары текущей conversation/generation; offer исчезает при следующем user send/mutation/reset/reload/dispose. Существующая Memory surface показывает «Предположение, не подтверждено» и точный источник, сохраняет гипотезу только по явному «Сохранить как предположение» с согласием на будущую AI projection. Worker перечитывает source adjacency/roles/confirmability; запрещены suppressed/чужие topic/card pairs, assistant-only, summary, lore, previousInitiative, fallback и quiet-support localOnly. UI не передаёт авторитетный proposal: Main разрешает offerId в сохранённые value/source; новый offer из старой пары/replay запрещён. «Хочу кофе» само по себе не создаёт никакой durable записи и ни при каких AI-output/summary/replay не становится confirmed; отдельное ручное подтверждение означает новое утверждение пользователя, а не доказательство старой догадки.

**Независимые оси и переходы.** provenance=model_proposal при сохранении гипотезы, user_statement после явного подтверждения/исправления; validity=hypothesis/confirmed/rejected; manuallyCorrected=false до явной замены противоположного значения, затем true до удаления; status=active/withdrawn независимо от provenance. Подтверждение не стирает source association первоначальной гипотезы. Никакие age/count/model confidence/повторная перефразировка не повышают validity. Сохранение proposal → active hypothesis; явное «Подтверждаю: предпочитаю кофе/чай» в карточке с показом значения → confirmed user_statement; исправление на другое значение → confirmed user_statement/manuallyCorrected; «Неверно» → rejected/withdrawn; «Отозвать» → withdrawn без объявления ложности; «Удалить» → отсутствие payload. Ручной confirmed click — самостоятельное новое утверждение пользователя о показанном значении; selected pair сохраняет происхождение/контекст, но не притворяется цитатой противоположного вкуса. Current source в DTO — текущая связанная пара, первоначальные source IDs остаются отдельно в memory_item_sources. Public confirm/correct несёт expected ref/value, а Main разрешает собственную source pair из актуальной записи (после restart новый диалог не требуется); внутренний repository command проверяет source pair и CAS; допустим собственный suppressed source, новый source обязан быть свободен от чужой suppression. Reactivation/замена rejected/withdrawn только явным confirm/correct; повторное сохранение guess требует удаления прежней записи и новой пары. Свободная фраза модели никогда не выполняет эти переходы.

**Точная разговорная поправка.** Для существующей записи локальная команда — вся trim/NFC/lowercase реплика, с одной необязательной конечной `.`, `!` или `?`: `я предпочитаю кофе`, `я предпочитаю чай`, `нет, я предпочитаю кофе`, `нет, я предпочитаю чай`, `нет, предпочитаю кофе`, `нет, предпочитаю чай`; EN `i prefer coffee`, `i prefer tea`, `no, i prefer coffee`, `no, i prefer tea`. Это узкий recognizer, не общее AI-понимание. Совпадение с opposite value сначала durable withdraw старой записи в preflight, с той же generation/summary/chat/events barrier и сохраняемым pending input admission token, что §14; без commit нет provider dispatch/обещания исправления. Для hypothesis/rejected/withdrawn с прежним value выполнить такой же withdraw до подтверждения; active confirmed с тем же value — no-op, не новое evidence. Неизвестные перефразы не автоклассифицируются: current user correction приоритетна в prompt, а надёжное durable исправление доступно через карточку. Explicit replyToInterestThread имеет приоритет: до любого withdraw beverage recognizer пропускает такой ввод, сохраняя topic binding; исправить вкус можно отдельной manual card command. Без существующей записи recognizer ничего не создаёт и scalar extraction не расширяет.

После acknowledged preflight обычный ответ использует текущий ввод, но не прежнюю preference projection; старый source/summary/volatile context уже excluded. Trusted beverageCorrection binding содержит post-withdraw ref/requestId/current userMessageId. Любой persisted bound correction append, включая fallback/memoryConfirmable=false, атомарно добавляет source suppression и replay receipt; только successful memoryConfirmable=true дополнительно подтверждает correction с новым revision. Fallback, timeout, crash или append failure оставляет старую запись withdrawn и новое значение неподтверждённым; storage failure даёт существующую diagnostic. Если pair не записана, подавлять нечего. Потеря ack не разрешает второй append/confirm: exact повтор operation IDs/digest возвращает historical outcome; другой callback/request binding тех же IDs — conflict. На первое успешное совпадение со старым value manuallyCorrected не повышается. При external mutation/reset/reload/dispose token и binding отменяются; после await проверяются generation/ref/source. Один абсолютный200ms preflight/recall/summary/topic бюджет и unsettled admission group §14; commit может закончиться поздно, но не продолжить отменённый send. Storage failure не разрешает retry нового commandId или отправку старой preference.

**Suppression, replay и retention.** Reuse всех правил §10.2–10.3: каждая связанная с сохранённой записью source/proposal/confirmation/correction pair permanently suppressed по opaque IDs для recent/volatile/history recall, summary source selection и других extraction paths; atomically добавить новой correction pair suppression при append. Каждый request с реально отправленной current projection получает trusted beverageUse ref/requestId/userMessageId; любой его persisted output pair (включая fallback) suppress в append transaction, чтобы assistant paraphrase не вернулась через summary/recent/recall после delete. Это consumer association, не новое evidence; она может сосуществовать с topic use, но не разрешает повторное сохранение той же пары. Dropped-before-dispatch block не создаёт use. Любая самостоятельная mutation синхронно повышает generation, отменяет dialogue/events/summary, очищает cached text/coverage/previousInitiative и выполняется worker barrier; rollback не оживляет callbacks. Bound correction append — завершение уже admitted mutation в той же generation/CAS, без второго независимого barrier: связанная пара исключается из volatile/summary/proposal ещё до pending append (видимый reply остаётся); перед принятием новой projection summary инвалидируется и capture перечитывается. Нельзя вернуться к старому тексту из summary/assistant paraphrase/model proposal, receipt или restart. Новая пользовательская пара не блокируется по похожим словам; старый source с новым offer/item/commandId остаётся запрещён. Будущее source edit/delete должно withdraw зависимую запись в той же transaction; generic transcript editor этим slice не вводится. Sharing sources с topic/cards запрещён; защитная invalidation импортированного состояния сохраняет §14.

Additive migration4 транзакционно перестраивает memory_items с расширенным category CHECK и category-specific nullable columns для value/provenance/validity/manuallyCorrected; CHECK constraints изолируют beverage category, гарантируют единственность slot, корректные combinations и непустой source; старые event/joke payload/CRUD остаются прежними. Rebuild сохраняет все IDs/rows/source FKs/terms/indexes/order и receipts; никакого drop source data, отключения FK-validation вне transaction или частичного version bump, rollback оставляет schema3. Служебные label/text генерируются из enum, не дублируют свободный профиль; beverage не проходит generic card confirm/update API и generic item recall. Reuse memory_item_sources/memory_suppressed_pairs/memory_mutation_receipts и source association, без новой таблицы знаний/графа. UpdatedAt приходит через инъекцию, не из LLM. Receipt digest включает kind/ref/value/source; preflight withdraw и append correction имеют разные стабильные operation IDs; повтор с тем же digest возвращает historical outcome, другой digest → conflict. Для correction/consumer binding защищать requestId и обе message IDs от bound/unbound replay по правилам §14; existing turn receipt механизм допустимо обобщить внутри существующей памяти, без отдельного хранилища. Возраст не подтверждает и не опровергает: payload хранится до явного delete/full reset, неактивный исключён из всех AI paths немедленно; cap1 ограничивает профиль без выдуманного TTL. Source IDs/нетекстовые receipts остаются до full reset, payload удаляется при delete; transcript сохраняется с честной подписью §10.2. Migration не извлекает знания, не переписывает schema1–3/snapshot; summary source reader принимает schema4 и прежнюю suppression. Full reset одной transaction очищает payload/receipts/suppression/источники; future schema/rollback/startup failure — §3–6.

**Bounded recall и приёмка.** За один exact indexed category lookup прочитать ≤1 current запись и её текущую source pair по IDs, без scan прошлых associations в общем200ms бюджете, проверить generation/source/ref/status; только active hypothesis/confirmed допускается как отдельный optional блок обычного user chat, без вытеснения baseline или нового social/event consumer. Никакого сканирования transcript, числового confidence или автоматического repeated evidence. Rejected/withdrawn/deleted/invalid source/timeout → omission, без late enrichment. Не менять topic eligibility/attempt/reply, Character axes, #123 quiet support, #69 A/B и #93 clicks. Проверить RU/EN proposal→guess→confirm/correct/reject/withdraw/delete, временное желание/цитаты/summary/replay, cap/CAS, storage failure/restart/reset/dispose/late callback, suppression во всех context paths; wire/freeze/mock-only acceptance — Backend Memory §8. Числа cap1 и quote240 — минимальность одного сценария и reuse существующего candidate quote budget; это engineering bounds, не предпочтения пользователя.

## 16. Локальные наблюдения распорядка (#127, архитектурная цель)

Это согласованная цель, не описание реализованной функции. Первый implementation slice — автоматическая запись при работающей Wisp, bounded локальное чтение/статус и full reset; AI и вывод привычки включаются отдельно. Пользователь выбрал системную активность, хранение всей истории локально без возрастного TTL и будущую работу с ней в обычном диалоге; opt-in, новый выключатель, инициативы и сжатие этим этапом не вводятся. Наблюдение не означает сон, работу, физическое присутствие или активность за пределами работающего приложения.

**Источник и владельцы.** Только существующий [SystemIdlePort](../../src/application/ports/system-idle.port.ts) и классификация [Perception §7.1](PERCEPTION_ENGINE.md#71-системный-idle-и-вероятное-отсутствие-afk-a01). Один Main sampling owner читает источник при наличии хотя бы одного потребителя: autonomy или routine recording; выключенная автономность не выключает recording и не вооружает return. Domain получает время/сигналы явно и определяет семантику длительностей; Application оркестрирует capture/порты, Infrastructure хранит через прежний SQLite worker. Нет второго poller, timer, event bus, OS discovery, чтения приложений/экрана или анализа сообщений. Старые диалоги, запуск приложения, assistant replies и summary не превращаются в activity evidence.

**Покрытие.** Зачислять только интервал между двумя последовательными fresh samples `available` с finite `idleMs>0` одной continuity, с одинаковым валидным presence и разрывом ≤2500 ms; смена presence делает переходный интервал unknown. Freshness, zero/unconfirmed, sequence и clock guards — Perception. `active` означает недавний системный ввод по AFK hysteresis, а не длительность печати. Не освежать sample кешем, нулём или последним известным состоянием. Unknown/unsupported/read failure, suspend/lock, app-off и crash gaps не считаются inactivity/away, не заполняются задним числом и не дают отрицательного evidence. На Wayland без доступной capability вывод отсутствует; непрерывный ввод с неоднозначным zero может уменьшить наблюдаемое покрытие.

**Семантическая запись.** В RAM агрегировать длительности active/inactive/probably_away/unknown внутри максимум пяти минут непрерывного монотонного времени; закрывать агрегат на границе UTC-пятиминутки, local day/offset, hard clock/zone break, lock/suspend, shutdown или reset. Обычный zero/read failure/freshness gap сбрасывает только sample-pair baseline: внутри того же календарно непрерывного агрегата это unknown, без flush на каждый source error и без classified интервала через gap. Писать immutable partial aggregate, а не каждую секунду, координаты или raw idle values. Empty/zero-length rows запрещены; последовательный unknown не открывает новый участок/row на каждом poll. Не более одного pending flush и одного текущего RAM aggregate: при переполнении закрытый неподтверждённый участок теряется как gap, статус degraded, без неограниченной догрузки или нового ID для неизвестного исхода. Сохранить UTC start/end, IANA zone/offset и local date, identity clock-cohort, appRunId/возрастающий aggregate sequence, tuning identity и четыре длительности. Anchor wall↔monotonic фиксируется для непрерывного участка, duration не экстраполируется из календаря; сумма длительностей не превышает его интервал. Unknown обозначает только известный пробел при работающем sampler, не все часы закрытого приложения. Ограничить объект и валидацию явно до реализации; timezone должен быть известен, unsupported/invalid zone не заменять выдуманным UTC.

**Storage и рост.** Новая additive migration после schema4 добавляет отдельную observation category/table внутри существующей памяти; старые миграции/snapshot/факты не переписываются. Source of truth — acknowledged SQLite aggregates, не RAM и не модель. Ключ appRunId+sequence, одинаковый повтор с тем же payload — no-op, другой payload — conflict; generation проверяется до записи. Непрерывная работа со стабильными часами/зоной без lifecycle breaks даёт около288 строк/сутки, независимо от обычных valid/unknown переходов или105120/год; восемь часов ежедневно — около35040/год. Restart, hard clock/zone и lifecycle breaks добавляют partial rows, поэтому это оценки, не верхние границы. При условных150–400 байт/строку это примерно16–42 MB/год круглосуточно до неизвестных расходов индексов/WAL/pages; фактический размер измеряет исполнитель, формат не обещает такой размер. Общего disk cap/автоудаления нет по выбору пользователя; заполнение диска/очереди — обычная деградация §3–4, не молчаливое удаление истории. Сжатие/частичная очистка — отдельные задачи.

**Четыре identity.** Persisted dataset epoch меняется только при полном reset и отделяет удалённый набор от нового; inference cohort сохраняется между обычными restart и memory mutations, меняется лишь при несопоставимом календаре/часах. AppRunId/segment разделяют непрерывные участки; memory generation отдельно отбрасывает устаревшую async работу. Обычная beverage/card mutation не обнуляет накопленные дни/cohort: новый capture получает актуальную generation после barrier, старый callback не переименовывается в новую. Full reset атомарно ротирует dataset epoch вместе с удалением rows; old-epoch append/receipt/retry отклоняется даже при совпавших локальных sequence.

**Restart и календарь.** До readiness записи нет; volatile startup не накапливает неограниченную очередь для последующей догрузки. При restart начать новый участок с новым appRunId, не соединять его с предыдущим sample/незакоммиченным хвостом. Внутри одного clock-cohort UTC интервалы не перекрываются; несовместимый overlap — conflict при записи и omission всей гипотезы при чтении, без first-wins или сложения. Смена IANA zone, backward clock или wall/monotonic discontinuity создаёт новый cohort и инвалидирует derived state без удаления старых наблюдений. Startup сверяет wallNow с последним сохранённым UTC end; откат запрещает reuse cohort. DST offset change разрывает агрегат; для первого алгоритма исключить целиком затронутую local date из inference. Старые timestamps не перегруппировывать в новую зону; часы ОС не становятся внешне проверенным временем.

**Bounded статус этапа1.** Порт включает только append, readStatus и full reset через существующий lifecycle; список/пагинация сырых наблюдений пока не имеют потребителя и не вводятся. ReadStatus использует indexed LIMIT1; никаких full-table COUNT/scan при startup, tick или открытии UI. В существующей панели памяти показывать лишь текущий source/storage статус и дату последнего acknowledged наблюдения (indexed LIMIT1), без raw журнала, часов расписания или психологических чисел. Различать unsupported/unknown, initializing, persistent recording и volatile/error; отсутствие подтверждённой записи не доказывает отсутствие активности. Порты, worker protocol, exact-shape IPC и readonly presentation DTO объявляет следующий contracts-first implementation slice до adapters/UI; generation проверяется после каждого await. Ошибки не блокируют ввод/FSM/Motion; нет бесконечного retry или отправки в telemetry.

**Reset и потеря данных.** Full reset §6 одной worker transaction удаляет observations и derived state вместе со всей прежней памятью, повышает generation и обрывает RAM aggregate/все старые callbacks ещё до barrier. Потеря ack не означает успех; повтор сохраняет identity. Rollback сохраняет durable rows, но не оживляет старые callbacks. После успешного reset автоматически начинаются только новые наблюдения, без backfill/re-extraction. Crash может потерять текущий RAM aggregate и неподтверждённую запись, штатный shutdown пытается flush в существующий grace deadline; обещания нулевой потери нет. Profile single-instance lock и источник singleton те же §1; перенос между аккаунтами/персонажами не разрешён.

**Следующий AI gate.** Хранение всей истории и inference window различны: старые observations остаются, кандидат алгоритма читает только28 завершённых local dates текущего cohort, исключая текущий неполный день. Для текущего фиксированного шестичасового окна [00,06)/[06,12)/[12,18)/[18,24) eligible day требует ≥4h classified покрытия, positive — ≥1h active; N≥14 eligible, positive≥70%, из последних7 eligible ≥5 positive, последний eligible не старше7 календарных дней. Это консервативные стартовые эвристики для условной повторяемости, не вероятность/уверенность70% и не привычка всей жизни. Synthetic replay проверяет только заявленные предпосылки; пограничная полночь, смены расписания, пропуски и систематический zero могут честно дать omission. Для такого future query нужен индекс cohort/local-date, hard examined-row cap10000 (LIMIT10001→omission всей гипотезы, без расчёта по первым10000), ограниченные bytes и общий recall deadline200ms; timeout не заменяет лимит работы SQLite. Overlap/conflicted bins не суммировать; malformed/ambiguous/future timestamps дают omission, не привычку.

**Проекция и границы будущего этапа.** Перед подключением AI отдельно согласовать local hypothesis/freshness, точную optional wire projection, validation и защиту от повторного использования устаревших выводов через history/summary. Raw diary в author lore отвергнут: lore — авторский мир, inferred routine — приобретённая условная гипотеза; registry facts также не расширять произвольным текстом. Предпочтителен один structured optional atomic block только обычного user chat, с явно ограниченной областью «при работающей Wisp», window/counts/freshness и правом omission; без local IDs/raw rows, нового inference call, инициатив, model writes или server storage. Текущая correction/refusal пользователя приоритетна; AI не узнаёт расписание из собственных реплик. Wire ещё не расширен: [Backend Memory](../../../docs/contracts/BACKEND_MEMORY_CONTRACT.md#9-будущее-использование-распорядка-127).
