# Контракт движка памяти

Статус: архитектурные решения [P15-A01 / #21](https://github.com/zyzycode/project_wisp/issues/21) и [P15-A02 / #55](P15_A02_RESULT.md), 2026-09-18. §1–8 — persistence #6–#8; §9 — recall/extraction #56. Для текущего запуска пользователь временно исключил независимое review. [Выбор драйвера](../adr/ADR-016-local-memory-sqlite.md#decision); [P15-A01 RESULT](P15_A01_RESULT.md).

## 1. Границы, владение и источник истины

`Renderer → typed Preload/IPC → Application → Infrastructure → SQLite worker`.

- Domain владеет семантикой Character/Activity, не JSON, SQL, временем ОС или lifecycle БД.
- Application владеет use cases, generation, IDs/временем через инъекции, проекцией состояния и bounded context. Хранение, подбор воспоминаний и сборка provider context — разные обязанности.
- Main создаёт один persistence adapter и управляет его lifecycle. Connection принадлежит единственному Infrastructure `node:worker_threads` worker внутри процесса Main. Это не второй Brain, не backend и не Renderer worker: никаких Electron/UI/provider/Domain effects в нём.
- Worker выполняет последовательные короткие транзакции `better-sqlite3@13.0.3`; Main не выполняет синхронный SQL. Typed сообщения worker — приватный Infrastructure transport, SQL/пути не являются командами Application или IPC. Входы и ответы проверяются из `unknown`; fatal worker error завершает все ожидающие операции нейтральной ошибкой.
- Локальный файл `path.join(app.getPath('userData'), 'memory', 'wisp.sqlite3')` — источник истины **подтверждённых сохранений** одного локального пользователя/экземпляра персонажа. Живой CharacterState принадлежит Domain/Application; БД — его последний checkpoint. Preset/configuration — источник identity/caps. Повторный запуск portable-приложения из другого каталога использует тот же userData, пока профиль не изменён.
- MVP не привязывает БД к backend login. Смена аккаунта/несколько персонажей и автоматический перенос памяти требуют отдельного identity/privacy gate; запрещено молча присваивать локальную историю новому аккаунту.
- Сеть, аккаунт и provider не нужны для открытия/записи/restore. Renderer получает только presentation DTO; OS-specific ветвления остаются за `IPlatformAdapter` в `src/infrastructure/platform/`.

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

Перед первой новой записью закрыть незавершённые сессии; `ended_at = max(started_at, suppliedNow)` защищает от отката часов. Нет пустых сессий после неуспешной записи пары. Summary и автоматическая сегментация не требуются MVP; #55 использует пары исходных сообщений без новой таблицы.

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

#8 принимает только уже проверенные явные факты и существующий source_message_id; null допустим лишь для доверенного локального ввода вне разговора. Confidence — уверенность нормализации, не разрешение домысливать. Извлечение, inferred facts, evidence/history, определения ключей и автоматический вызов upsert из диалога — #55/#56. Этот gate не вводит extraction.

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

Составной ключ защищает от повторного terminal, перезапуска и повторного использования activityRunId. Идентичный повтор — no-op; отличный payload того же ключа — `conflict`, первая запись сохраняется. `IGameEpisodeRepository.append` — единственный необходимый порт; recall/list появится вместе с его потребителем в #55. Ошибка сохранения не отменяет уже применённый play effect и не повторяет его.

### `character_state`

| Колонка | SQLite type | Правило |
|---|---|---|
| `id` | `TEXT` | primary key, not null, CHECK = 'singleton' |
| `snapshot_json` | `TEXT` | not null; конверт `{ snapshotVersion, state }` |
| `updated_at` | `TEXT` | not null; время checkpoint |

Форма v1 задана в `CharacterMemoryStateV1`, версия envelope независима от schema. Сохраняются Needs, Relationship, Intimacy, current axes и preferences. Только presetId, без копии base/soft/hard limits, plasticity, displayName/self-concept. Нет FSM/Activity/Motion, окон, stream/request IDs, pending provider, quiet, cooldowns или lastUpdated системных часов. Адаптер проверяет JSON/envelope, Application мигрирует state, Domain проверяет значения относительно установленного preset (§4).

### `schema_migrations`

| Колонка | SQLite type | Правило |
|---|---|---|
| `version` | `INTEGER` | primary key, positive |
| `name` | `TEXT` | not null; неизменное имя миграции |
| `applied_at` | `TEXT` | not null |

`PRAGMA user_version` и непрерывный журнал обязаны совпадать. Каждая последовательная миграция обновляет DDL/data, журнал и user_version в одной транзакции. Уже применённый SQL не редактировать; новые изменения — новая версия. Непустая БД без известной версии, разрыв журнала или несовпадение имени — `corrupt`, будущая версия — `unsupported_version`. Нет down-migration, неявного DROP/recreate или автоматического исправления журнала.

### Retention и расширение

MVP хранит подтверждённые сообщения, текущие факты, игровые эпизоды и один checkpoint до явного полного reset. Нет TTL/автоудаления истории по лимиту AI context; при заполнении диска — §4. Локальные записи не экспортируются в telemetry; логи содержат код операции/ошибки без текста, snapshot, SQL и пути.

Обобщённые `memories`, summary, FTS/vector tables, ranking/expiry и их порты из прежнего черновика **не входят в schema v1**: актуальных use cases до #55 нет. Игровой эпизод уже имеет реальный потребитель записи в #7. Будущий recall читает исходные записи через Application ports; index является производным, с устойчивой ссылкой на источник, обновлением/удалением и перестроением. Потеря индекса не означает потерю памяти. Формат и миграция индекса — отдельный gate, пустые providers/adapters не создавать.

## 3. Connection, операции и ошибки

На connection: `foreign_keys=ON`, `journal_mode=WAL`, `synchronous=FULL`, `busy_timeout=5000`, `trusted_schema=OFF`; проверить фактически установленные значения. Defensive mode включён по умолчанию, `unsafeMode(true)` и вызовы `loadExtension` запрещены. WAL недоступен — `unavailable`, без молчаливого downgrade durability. Данные параметризованы, SQL/DDL только встроенные; путь не приходит из IPC.

Infrastructure сериализует **все** repo operations/reset/shutdown через один worker. Никаких await внутри SQL transaction. Очередь ограничена 100 ожидающими командами, переполнение → `busy`; latest checkpoint coalescing вместо накопления кадров. Для reset/close оставить управляющий слот. При I/O ошибке нет бесконечного retry; write acknowledgment только после commit. Promise timeout не доказывает rollback: без acknowledgment запись имеет неопределённый исход; разрешён только повтор тех же IDs, а не новый ID.

`MemoryResult` типизирует ожидаемые ошибки; `stale` — отброшенная generation, `invalid_data` — row/payload validation, `conflict` — конфликт идентичности, остальные — storage/capability failure. Raw exception не пересекает adapter. Generation — non-negative safe integer, начальная 0; reset принимает ровно current+1, остальные операции — только current. Неожиданная ошибка и невозможность восстановить очередь переводятся в unavailable. Все аргументы валидируются, включая finite numbers, длины и read limit 1..100; ошибочный limit не означает SELECT без LIMIT. IDs non-empty до 128 UTF-16 units, fact key до 128, value до 2000; сообщения используют [диалоговые лимиты](AI_PROVIDER_CONTRACT.md#контекст-reset-и-lifecycle).

Все даты — `YYYY-MM-DDTHH:mm:ss.sssZ`, с проверкой календарной валидности. UTC clock и monotonic deadlines различны. Envelope ограничен 1 MiB UTF-8, preferences — 256 ключами по 128 UTF-16 units; эти storage caps не создают новые правила адаптации. Snapshot не хранит числовое lastUpdated; после restore оно равно текущему Domain clock. Read DTO immutable, mutable driver rows не возвращать.

## 4. Lifecycle, restore и деградация

### Запуск/завершение

1. Main получает single-instance lock для профиля до открытия БД. Запускает worker на стадии bootstrap до старта Character ticks, параллельно создаёт окно. Первый пользовательский ввод, требующий Character, немедленно завершает ожидание restore и запускает defaults в volatile mode; ввод не ждёт storage.
2. Worker открывает локальный userData, выполняет `quick_check`, проверку версии/журнала, миграции и `foreign_key_check`, закрывает старые sessions, читает snapshot. До этого запись запрещена. Startup deadline — 10 s; при превышении немедленно запустить volatile runtime, worker завершить асинхронно с ожиданием exit перед любым повторным открытием БД. Поздний startup response не применяет state.
3. Application применяет валидный snapshot один раз до первых изменяющих Character stimuli/ticks, затем запускает Brain. Если ранний ввод уже запустил локальный runtime, текущая сессия остаётся volatile, worker закрывается, поздний restore запрещён. Приложение показывает нейтральный статус; повторная попытка — следующий запуск, без скрытого merge свежего и сохранённого state.
4. После readiness — semantic writes и checkpoint не чаще раза в 5 s при dirty state, latest-only. Штатный shutdown закрывает приём новых writes, отменяет provider/activity callbacks, сохраняет последний snapshot, закрывает session и connection, ждёт worker exit. Общий grace deadline 7 s; при истечении — завершение worker, никакого обещания сохранения неподтверждённых данных. Crash может потерять последний checkpoint/неподтверждённую пару, но не требует runtime для recovery WAL.

### Restore snapshot

Application мигрирует только известные старые snapshot versions последовательными чистыми функциями; v1 — первая версия, legacy full CharacterState не угадывать. Валидация exact-shape, finite/ranges и Domain invariants предшествует применению. Числа вне hard caps, неизвестные axis/поля, несовпавший presetId, некорректные preference samples/consent gates отклоняют весь snapshot, без частичного clamp ради принятия.

Из актуального immutable preset создаётся новый state; восстанавливаются только разрешённые динамические поля. Runtime timers/cooldowns/Activity/quiet/FSM строятся заново; tone пересчитывает Character. Нет offline metabolism/relationship decay за закрытое приложение, lastUpdated устанавливается текущим clock. Успешный restore не применяет повторно stimuli, game effects или provider hints.

Пустой snapshot → defaults с последующим обычным checkpoint. Corrupt/unsupported snapshot → defaults и соответствующий characterRestore в MemoryStatusDTO; исходная строка сохраняется, её автоматическое перезаписывание запрещено до успешного явного reset или поддерживающей версии. Остальные валидные таблицы доступны, поэтому это отдельная ошибка restore, не ложное объявление всей БД повреждённой.

### Ошибка БД/capability

Corrupt SQLite/NOTADB, неуспешная migration, future schema, read-only/userData недоступен, disk full или worker failure: rollback где возможно, остановка durable writes и `MemoryStatusDTO.mode=volatile`. `busy` одной операции допускает отказ без закрытия исправной БД. При системной деградации текущая runtime-сессия продолжает работу с ограниченным volatile dialogue context и живым CharacterState; durable backlog не копится и не проигрывается скрыто позже.

Исходный файл и WAL/SHM не удалять, не переименовывать отдельно и не заменять пустой БД. Нет автоматического quarantine/export/backup с незаданным retention. Recovery — поддерживающая версия/исправление условий и новый запуск; для повреждённой БД, которую нельзя открыть, reset возвращает failure. Ручное восстановление/удаление файлов и recovery UI — отдельная задача. Никогда не трактовать ошибку чтения как пустую подтверждённую память.

## 5. История, подбор и AI context

Хранилище не вызывает provider и не знает token budgets. `getRecent` выбирает последние N по sequence, возвращает oldest-first. Application builder использует `ChatContextLimits`/`DEFAULT_CHAT_CONTEXT_LIMITS`: 20 сообщений, 8000 UTF-16 units суммарно, 2000 на сообщение. Сначала ограничить отдельный текст (не разделяя surrogate pair), затем удалить старейшие сообщения до общего лимита. Историю в БД не менять. `assistant` отображается в provider role `wisp`; текущий userMessage передаётся отдельно, не добавляется второй раз.

#7 подключает persistent context только к локальному Mock; network provider сохраняет существующие три volatile завершённые пары из [AI contract](AI_PROVIDER_CONTRACT.md#контекст-reset-и-lifecycle). Наличие history/facts/game/state в SQLite не разрешает новый сетевой payload. Persisted context, extraction, recall и retention/delete у backend/provider — #55/#56; существующий wire v1 здесь не меняется.

Dialogue reset/reload очищает runtime context по AI contract, **не удаляет БД**. Persistent hydration Mock выполняется один раз на Main startup; после dialogue reset старые сообщения не подмешиваются снова в текущую conversation. Новые завершённые turn продолжают сохраняться в storage session этого запуска. При read/write failure #7 продолжает с bounded runtime context, status/diagnostic не выдаёт volatile данные за сохранённые. Facts/эпизоды/summaries пока не участвуют в context; storage и future recall не влияют на Character напрямую.

## 6. Полный reset и защита от поздних записей

Полный memory reset — отдельный `ClearMemoryUseCase`; `DialogueCommandDTO.type=reset` остаётся reset разговора. Целевые [ClearMemoryCommandDTO/ResultDTO](../../src/shared/ipc-contracts.ts) связываются с typed `window.wispAPI.clearMemory` в #8 атомарно с Main handler, Preload и exact-shape validation. Пока это типы, а не объявленный работающий bridge. Статус отдаётся через typed window.wispAPI.getMemoryStatus() без аргументов. Sender проверяется как у dialogue; streamId/requestId non-empty до 128 units, sequence positive safe integer с отдельным счётчиком на Brain stream, неизвестные поля запрещены. Malformed/untrusted input отклоняется до use case; неверный stream или устаревшая sequence возвращает failed/stale. Внутренние invalid_data/conflict проецируются в io_error, без payload ошибки. Нового Settings UI в #8 нет.

1. Application закрывает admission persistence-producing turns/games/checkpoints, отменяет активные owners/диалог логически; повышает memory generation. Каждый async callback хранит generation начала и проверяет её **после каждого await и перед side effect**; текущую generation нельзя присваивать старому result задним числом.
2. `IClearMemoryStore.clearUserMemory(nextContext)` — барьер в той же worker queue. Более ранние writes закончатся до него и будут удалены; последующие со старой generation отклоняются как `stale`. Worker принимает новую generation до транзакции и не откатывает её при SQL rollback. Параллельные reset сериализуются; идентичный повтор streamId/sequence/requestId присоединяется к текущему результату, не удаляет новую память второй раз. Последние 100 receipts хранятся в Main; после eviction high-water sequence всё равно отклоняет старую команду как stale. Повтор использует ту же тройку, новая пользовательская команда — новый requestId и sequence; replacement stream инвалидирует старые команды.
3. Одна транзакция удаляет `user_facts`, `game_episodes`, `messages`, `conversation_sessions`, `character_state`. Схема, schema_migrations, user_version, файл, immutable identity/config и appearance/behavior settings сохраняются.
4. Только после commit Application очищает history/facts/snapshot caches, заменяет динамический CharacterState defaults (включая отношения, intimacy, preferences/axes, Needs), сбрасывает старые runtime cooldowns/owners и создаёт новый app_run_id для памяти. После этого возвращает `cleared` и открывает admission. Следующий checkpoint пишет только новый state.
5. При rollback — failure, прежние durable записи и CharacterState сохраняются, admission возобновляется в новой generation; старые async results всё равно недействительны. Потеря worker/ack во время reset → `unavailable`, остановка persistence до restart; нельзя сообщать success по одному истёкшему таймеру или восстанавливать отменённые операции. Startup читает фактически закоммиченное состояние.

Reset удаляет логическую локальную память, не обещает forensic erasure страниц/WAL/OS backup и не удаляет серверные копии. Volatile fallback при существующей недоступной БД не имеет права сообщать `cleared`: без durable commit старые данные могли бы вернуться после restart. Политика удаления серверных данных — отдельный контракт.

## 7. Нецели и gates

Для #6–#8 нет extraction/recall/автоадаптации; они не расширяются последующим §9 задним числом. Embeddings/vector DB, FTS, cloud sync, server memory, многопрофильность и graphic assets остаются вне MVP. Последствия #6–#8 — [P15-A01 RESULT](P15_A01_RESULT.md#implementation-consequences), #56/#57 — [P15-A02 RESULT](P15_A02_RESULT.md#implementation-consequences).


## 8. Integration scope и платформенная приёмка

До Ready #6 требуется отдельное разрешение `package.json`/`package-lock.json` для [одобренных exact versions](../adr/ADR-016-local-memory-sqlite.md#dependency-review), `vite.config.ts` для bundled worker entry и externalization driver/Node builtins. Исходник/transport worker — `src/infrastructure/`, output — существующий `dist-electron/`. В electron-builder проверить `files`, упаковку runtime JS/native binary, `asarUnpack` и packaged worker path; менять при необходимости только существующую секцию `package.json`. Новый packager, ORM, rebuild tooling, scripts и расширение targets этим разрешением не предусмотрены.

Windows-first gate: Electron 43.4.1, win32-x64, загрузка addon из worker в dev и предоставленном packaged portable, `sqlite_version() = 3.53.4`. Проверить userData с пробелами/кириллицей, offline startup/restart, миграции/reset; при DB lock на 5 s drag/input/Brain ticks продолжаются, очередь bounded. Зафиксировать actual версии, artifact и размер поставки. Подготовка artifact — отдельный packaging scope; `npm run build` запрещён.

Host Node/Vitest и более новые `@types/node` не доказывают совместимость с Electron runtime. Linux Wayland/X11 и macOS сохраняют тот же контракт и graceful native-load/capability fallback из §4; непроверенные платформы отмечать NOT RUN. На машине пользователя не скачивать и не собирать addon автоматически; наличие arm64 prebuild не расширяет текущую Windows x64 цель.

## 9. P15-A02: явные знания и простой recall

Типы — [memory-knowledge.interface.ts](../../src/application/ports/memory-knowledge.interface.ts). Application разделяет source validation, repository writes, recall selection и provider-context projection. Новой SQLite migration нет: `user_facts`, `messages`, `game_episodes` и snapshot v1 достаточны. Additive `IGameEpisodeReader` в #56 читает 1–20 эпизодов, newest-first по приватному SQLite rowid; writer/его семантика #6/#7 сохраняются.

### Что сохраняется и откуда известно

| Категория | Семантика MVP |
|---|---|
| Явный факт | Буквальное утверждение пользователя из registry ниже; source — ID сохранённой user-реплики, не ответ модели |
| Исправление | Новое подтверждённое значение того же key; последняя принятая операция заменяет value/source, сохраняет fact id/createdAt; старое утверждение остаётся в исходной истории |
| Эпизод | Завершённая пара исходного диалога либо реальный terminal курсорной игры из #7; не сгенерированное summary |
| Пожелание | «Отвечай кратко» действует в текущем диалоге; только явно устойчивый вариант registry становится user preference, не приказом изменить Character axes |
| Временная роль | «Сегодня будь пиратом», цитата, гипотеза, пересказ чужой речи; текущий dialogue context без persistent fact и adaptation evidence |

В MVP registry конечный: пять scalar keys, один текущий value на key. `display_name`/`preferred_address` до 80 UTF-16 units, `favorite_topic` до 120; reply_style — `brief`/`detailed`, cursor_game — `like`/`dislike`. Извлечение не создаёт диагнозы, политические взгляды, credentials, обещания/напоминания или произвольные ключи. Такие сообщения могут остаться в истории по §2, но не превращаются в структурированные знания автоматически.

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

В memory-capable режиме #56 один admission собирает context с общим **200 ms** бюджетом чтения в пределах dialogue deadline. `facts.list(100)`, `history.getRecent(100)`, `gameReader.getRecent(20)`; нет полного scan всей БД/ожидания больше budget. Ошибка/таймаут любого read даёт пустой memory context на этот turn и безопасную storage diagnostic; поздний read не меняет уже отправленное и не пишет данные. Между turn нет polling/summary/LLM background jobs. Character snapshot и текущие три volatile пары доступны независимо от storage.

- **Always include:** актуальное авторское ядро/needs/отношения из CharacterSnapshot и все найденные пять registry facts с валидным источником/значением; неизвестные keys не передавать. Facts не зависят от совпадения вопроса. Character learned `activity.cursor_game` включается отдельно при confidence ≥0.5; user preference не выдаётся за вкус персонажа.
- Кандидаты dialogue: только полные соседние user→assistant пары одной session из последних 100 сообщений; исключить IDs текущего volatile context. Пару с любой распознаваемой registry-фразой исключить целиком: актуальные structured facts — единственный источник этих значений, старое исправленное значение не возвращается через episode. Также не подбирать пары с явным префиксом `Забудь`/`Forget`/`Сегодня будь`/`Today act as`.
- Query и pair text: NFC, lowercase, Unicode letter/digit tokens длиной ≥2; score — число различных query tokens в объединении user/assistant tokens. Только score >0, сортировка score descending, затем более поздняя insertion position. Ни RNG, ни embeddings, ни lemmatizer. Берутся максимум две пары; user ≤240, assistant обрезается до400 UTF-16 без разрыва surrogate pair.
- При query token с префиксом `игр`, `курсор`, `пойм`, `промах`, `ловил` либо `game`, `cursor`, `catch`, `caught`, `miss`, `play` одно из двух мест резервируется последнему сохранённому игровому эпизоду; остальное — лучший dialogue match. Outcome/длительность/время передаются буквально, без предположения об участии/удовольствии пользователя. Если игры нет, остаётся обычный dialogue подбор.
- Если последний storage-valid игровой эпизод имеет executedMs>60000 и не помещается в wire range, пропустить только этот эпизод без clamp/изменения SQLite и без подстановки более старой игры; оба места вновь доступны dialogue recall, facts сохраняются, storage corruption/ошибка всего chat не объявляется.
- Итого: ≤5 facts, ≤2 episodes (из них ≤1 game), ≤1 character preference; до2400 UTF-16 units всех memory text values (включая timestamps), общий HTTP byte cap проверяется отдельно. Не вмещающиеся episodes удаляются с конца ranking; ключевые facts/identity не вытесняются. Будущий индекс заменяет источник recall кандидатов за портом, не источник исходных записей.

Это bounded recall последних 50 разговорных пар/20 игр, а не обещание поиска всей истории. Старые structured facts доступны независимо от давности. Индекс/более глубокое чтение вводится следующим gate при измеренных пропусках; текущие source records не обрезаются по provider budget.

### Network mode и удаление

Provider DTO получает optional memoryContext только в явно выбранном Main режиме v2; сетевой payload — [BACKEND_MEMORY_CONTRACT](BACKEND_MEMORY_CONTRACT.md). v1 сохраняет прежний запрет memories; автоматического downgrade v2→v1/смены модели/второго запроса нет. После restart recall вновь читает сохранённое; после dialogue reset в новой conversation structured facts/релевантные episodes доступны по следующему явному user send, но не подмешиваются без запроса. Полный memory reset очищает источники по §6 и защищает поздние callbacks.

Исправление заменяет current fact, но не стирает исходный transcript. Команда забывания отдельного факта/редактирование истории не вводится: не обещать такого удаления в ответе LLM; полноценный full reset остаётся #8. `removeByKey` остаётся низкоуровневым портом для доверенного use case, не публичной семантикой «забыть навсегда». Retention server/cache/provider и отсутствие server-delete endpoint — [backend §6](BACKEND_API_CONTRACT.md#6-данные-сроки-хранения-и-удаление), с явным составом v2 из отдельного контракта.
