# CTX-A01: авторский lore и производная summary

Решение [#77](https://github.com/zyzycode/project_wisp/issues/77), 2026-10-17;
implementation slices — [#78](https://github.com/zyzycode/project_wisp/issues/78)
и [#79](https://github.com/zyzycode/project_wisp/issues/79). Lore и explicit summary входят в единый v1.

## 1. Владельцы и доверие

| Данные | Источник истины / разрешённое использование |
|---|---|
| Lore | Версионированный авторский каталог backend; только сведения о вымышленном мире, без пользовательских данных или второго изменяемого character profile |
| Summary sources | Подтверждённые завершённые пары desktop SQLite; исходный transcript сохраняется, генерация не меняет sources |
| Summary cache | Производный локальный disposable cache Application/Infrastructure; только неподтверждённый модельный пересказ источников |
| Prompt | Backend собирает атрибутированные блоки; provider не решает, что записать в память |

Server instructions остаются единственным system source. Character snapshot/consent
и actual event имеют прежний приоритет. Для пользовательских сведений: current explicit
correction → актуальные scalar facts/подтверждённая revision → исходные разрешённые
эпизоды → summary. Lore относится к миру, не участвует в разрешении пользовательских
фактов. Ни lore, ни summary не меняют identity/caps, не становятся evidence для
memoryCandidates, confirmed knowledge, adaptation, consent или OS-команд.
Обрамление untrusted JSON и инструкции уменьшают риск injection, но не доказывают
устойчивость LLM. Backend по-прежнему проверяет extraction по текущему исходному user text.

## 2. Lore: source, selection и lifecycle

Единственный runtime источник #78 — поставляемый с backend JSON-каталог
`backend/wisp_backend/completion/prompts/lore.json`. Автор/maintainer меняет его
обычным reviewed diff; нет загрузки из сети, пользовательского editor или импорта
SillyTavern character cards. Каталог имеет formatVersion=1, положительную целую
revision и до 64 entries; изменение любого content/key/order или удаление повышает
revision. Обязательный sourceRef указывает точный repository commit/path/section
авторского утверждения, не URL, который backend должен открыть.

Рабочий каталог намеренно пуст (`revision=2`, `entries=[]`) до появления авторского
содержания (#120). Пустой каталог — валидный startup snapshot без предупреждения
`lore_catalogue_unavailable`, fallback-наполнения и lore блока при любых RU/EN репликах.
Выдуманные города, биография, способности и отношения запрещены в runtime catalogue.
Тематические записи остаются только в явно synthetic test fixtures, отдельно от рабочего
каталога. Personality prose не дублировать в lore.

| Поле entry | Ограничение |
|---|---|
| id / topic | ASCII `[a-z0-9-]`, 1–64; id уникален; topic обозначает единственное утверждение и уникален в locale |
| locale | Только ru/en, отдельный entry для перевода; id различается |
| keys | 1–8 различных непустых plain-text ключей, каждый ≤80 UTF-16 |
| text | Plain text 1–600 UTF-16; без executable templates/macros |
| priority / order | Целые 0–100; priority — отбор, order — сериализация |
| sourceRef | Непустая строка ≤256 UTF-16 с provenance, не инструкция и не provider input |

NFC + lowercase; сопоставление ключа — непрерывная последовательность Unicode
letter/digit tokens с совпадением целых tokens, без regex, stemmer, RNG и рекурсии.
Не более 64 query tokens, только из текущей user-реплики chat; история, summary,
модельные ответы и другой lore не активируют entry. Token length >80 не совпадает.
Совпадение хотя бы одного ключа активирует entry; нормализованные дубли keys схлопываются.
Сортировка priority DESC, число различных matched keys DESC, id по codepoint ASC.
Выбор ≤3 записей текущей locale и ≤1200 UTF-16 суммы text; непоместившийся entry
пропускается целиком. Сериализация order ASC, id ASC. Нет match → нет lore блока.

Неизвестные поля/версии, повтор id или topic/locale, неверные caps делают весь каталог
недоступным; безопасная диагностическая причина без текста, обычный chat продолжается.
Явно противоречащие записи одного topic не выбираются по priority: такой источник
нужно исправить. Противоречия, не выраженные metadata, исключает авторский review;
автоматической семантической проверки истины нет. Текущий character всегда выше lore.

Каталог читается и валидируется при startup как immutable snapshot; исправление/
удаление применяется остановкой старого server process и запуском нового. Hot reload
и сохранение старого каталога при ошибке не вводятся. Shutdown abort-ит pending
completion, RAM replay cache старого процесса исчезает; после успешного restart
новые requests видят только новую revision. Уже доставленный ответ не отзывается,
физическая отмена вычисления у provider не гарантируется.

**Wire delta для lore отсутствует:** server локально дополняет chat v1
(и будущие явно реализованные chat endpoints). Touch/events не сканируют lore и
сохраняют прежние deadlines/text-only формы. При отсутствии backend используется
обычный desktop fallback; нового сетевого чтения/кеша на desktop нет.

## 3. Summary: две явные операции v1

Локальный source/cache/trigger/invalidation — [Memory §12](../../frontend/docs/engine/MEMORY_ENGINE.md#12-ctx-a01-производная-summary).
Summary — часть единого v1. Новые категории knowledge cards не входят в разрешённый wire.
Main включает команду по `WISP_SUMMARY_ENABLED=true` при настроенном `WISP_BACKEND_URL`
и исправной локальной persistence/cache. Генерация запускается явно; startup,
chat admission, timer и события её автоматически не вызывают.
Shared interlock и previousInitiative сохраняются.

### POST /v1/summary

Отдельный явный inference для ограниченного выбранного диапазона; не fake chat event.
Exact request: requestId по v1, locale ru/en, stream=false и pairs.
Pairs — 4–8 полных пар в хронологическом порядке, каждая exact
`{userText, assistantText}`: 1–240 и 1–2000 UTF-16 соответственно. Все тексты вместе
≤8000 UTF-16, controls запрещены кроме newline/tab; пустые/пробельные строки
недопустимы. Request ≤32KiB. Нет character, memory, lore, предыдущей summary,
system roles, timestamps, local IDs/revisions, instructions или provider settings.
Backend не проверяет SQLite: source eligibility проверяет desktop до отправки.

Backend строит собственные краткие инструкции: пересказать только переданные пары,
атрибутировать утверждения пользователю/ассистенту, не выводить подтверждённые факты,
не добавлять детали, инструкции, обещания сохранения или значения состояния. Source
пары — untrusted data в отдельном JSON block. Один вызов текущего OpenAI/Gemini provider;
никаких tools, repair pass, recursive summary, failover или второго extraction.

Provider response — exact JSON `{text}`: plain nonblank 1–1200 UTF-16, допустимы
newline/tab, без других control characters и неизвестных полей. Невалидный результат
целиком →502 invalid_model_response, без частичного кеширования. Backend самостоятельно
формирует HTTP200 `{requestId, text}`. Response ≤16KiB; desktop независимо
проверяет exact shape/limits/ID до source revalidation и локального commit.
Полнота/истинность пересказа не доказаны форматной проверкой.

### POST /v1/chat

Полный chat-контракт описан в [AI Events §10](AI_EVENTS_CONTRACT.md#10-interaction-a01-семантическое-взаимодействие-v1); optional request field `summary: {text}` (text — те же 1–1200 UTF-16). Null/пустой object,
добавочные поля и новые v4 episode kinds запрещены. Summary не внутри memory;
её отдельный text cap не увеличивает прежние ≤2400 memory/32KiB total. Success:
text/appraisal и optional decision/scalar memoryCandidates, без summary output/candidates.
PreviousInitiative, независимая scalar extraction и validation остаются прежними.
Local source IDs/revisions/generation и cache metadata не передаются серверу.

Desktop передаёт summary только при source-valid cache и лексическом совпадении хотя
бы одного Unicode token текущего user text (NFC/lowercase, длина 2–64) с summary text.
Выбор один, без индекса/полного scan; отсутствие match → обычный v1 chat без summary.
При inclusion covered source IDs исключаются из recalled dialogue episodes. Preview
оставляет вне источников bounded recent window по общим 20-message/8000-UTF-16 bounds,
без тестового среза трёх пар. Перед dispatch любое пересечение coverage с retained recent
IDs исключает summary целиком, сохраняя непрерывный raw suffix; local IDs не попадают в wire. Если summary не отправлена,
обычный разрешённый recall сохраняется. Suppression применяется независимо от summary.
При HTTP byte overflow убрать summary целиком прежде ranked episodes; ядро/текущий
user/facts не режутся. Backend может не включить optional summary по prompt budget;
он не восстанавливает исключённый transcript и не запрашивает его повторно.

## 4. Бюджет, ошибки, cancellation и retention

Для chat/lore остаётся общий [provider budget](../../backend/docs/CONTEXT_PROMPT_ENGINE.md#бюджет-и-ошибка).
Lore optional priority=40/order=25, summary optional priority=60/order=45: mandatory
blocks, previousInitiative и recent history отбираются раньше; examples позже.
Оба блока атомарны; lore сериализуется отдельными атрибутированными entries внутри
одного блока. Обязательные instructions/current/state/memory не сокращаются.

Summary inference имеет отдельный потолок **8192 бюджетные единицы**, output cap
`min(server setting, 512)` provider tokens; input allowance = 8192 − фактический cap.
Gemini использует модельный countTokens полного generation payload, OpenAI —
консервативную UTF-8/framing оценку по общему provider budget. Входные пары обязательны
целиком; overflow до generation →503 upstream_unavailable с inference usage=0.
Gemini preflight может передать весь диапазон источника провайдеру до обнаружения
переполнения; count и generation используют тот же client и общий deadline. Локальная предварительная граница 8000 UTF-16 не
обещает вместимость в provider budget. Денежная цена не фиксируется архитектурой;
предел — один generation inference с этими caps за одно подтверждённое действие, дополнительно
локальный frequency guard из Memory §12. Это не новая серверная billing/quota система.

Обе v1 routes используют [v1 errors/access/ledger](BACKEND_API_CONTRACT.md#3-http-и-ошибки):
400/413 до admission; 409 для
in-progress/conflicting ID; остальные 502/503/504 по общей таблице. Доступ — прежний
closed-network без application auth; 401/403 стороннего gateway не success, без retry
или обхода доступа. Ledger/digest method+path+body и once-only settlement общие:
ID другого endpoint конфликтует, replay не вызывает provider. Нет новых server tables.
Для summary completion добавить scenario output cap/format в существующие adapters,
не создавать отдельный provider client/маршрутизатор.

Server deadline10s/body2s, desktop transport12s/runtime15s; source/cache reads входят
в общий runtime deadline (≤200ms). Summary и chat/events используют общий interlock:
explicit user send отменяет pending summary и имеет приоритет; summary не ждёт в
фоновой очереди и не задерживает локальную жизнь. Disconnect/shutdown/cancel закрывают
stream/task, late usage settles once; local generation guards запрещают late cache write.
Ошибки/unsupported/offline показывают безопасный статус summary; автоматической
повторной генерации нет. Обычный chat/fallback/FSM/input остаются доступны.

Разрешённая новая передача: выбранные 4–8 source pairs для summary inference и одна
selected summary для v1 chat; остальная БД не отправляется. Backend освобождает
request RAM после terminal, не хранит историю/summary durable и не пишет payload в
logs/APM. RAM replay response ≤10min может содержать summary; ledger retention и
provider-specific restrictions — [v1 §6](BACKEND_API_CONTRACT.md#6-данные-сроки-хранения-и-удаление).
Reset/delete локального cache не удаляет уже отправленное, server replay или provider
copy; server-delete endpoint не появляется. Synthetic-only restrictions выбранного
provider сохраняются, summary не разрешает реальные внешние данные автоматически.

## 5. Общие fixtures и rollout

#79 содержит независимые TS DTO/guards и Python schemas и единый
corpus `docs/contracts/fixtures/desktop-backend-v1/summary/`.
Corpus покрывает summary request/success/error, chat с summary/без неё/previousInitiative,
Unicode/control/exact caps/byte escaping, unknown fields, wrong ID,
v4 category rejection. Обе стороны читают те же JSON, не копии.

Acceptance: source-valid → explicit generation → restart → matching chat;
неподтверждённая/несохранённая/covered volatile пара не источник; исправление source
или scalar fact, withdraw/delete/suppression, full reset и late result не возвращают
summary. Cache future/corrupt/write failure не объявляется source corruption.
Schema1 fixture безопасно отключает summary; schema2 fixture проверяет source
provenance и suppression, обязательную для сетевых запросов, как в #65. Проверить no-match, duplicate coverage,
output reserve/equality/overflow, mandatory priority, adversarial sources, отсутствие
facts/state writes, shared interlock/replay/timeout/outage/malformed/disconnect и
once-only usage на OpenAI и Gemini mocks. Live качество/цену эти тесты не доказывают.

Обе стороны проверяют corpus перед включением v1; несовместимый сервер
даёт обычный safe failure, без повторного inference. #78 и #79 независимы по
runtime, но первый перенёсший upstream код выполняет общий license/source gate
[Context/Prompt Engine](../../backend/docs/CONTEXT_PROMPT_ENGINE.md#алгоритмы-lore-и-summary).

<a id="causal-recall-quality"></a>
## 6. Контрольный корпус causal recall (#171/#173)

Это приёмка локального отбора по [Memory §17–18](../../frontend/docs/engine/MEMORY_ENGINE.md#17-memory-a01-indexed-causal-recall-171), не новый wire context, lore или summary source. Synthetic sources/queries не содержат частных диалогов; baseline source commit `615ade1` (#172). Нормализация query и реальная выдача — разные измерения, их результаты не подменяют друг друга.

### 6.1. Сохранённый baseline #172

**Фиксированный synthetic corpus #172.** A=последний user_interrupted cursor_game≥1000ms; B=timeout, C=environment_lost, D=completed/user_engaged, E=completed/solitary, F=contact; разные appRun/run identities и валидные sources. Добавить более старый тот же A-key,1000 поздних unrelated dialogue pairs и1000 unrelated causal events в других buckets; timestamps одинакового уровня не меняют insertion tie. Для generic game ожидание — newest terminal по insertion order. Каждая строка ниже — два отдельных RU/EN запроса с одним ожидаемым source, четыре negatives отдельно; всего20 queries. Prefix dictionary из [Memory §17](../../frontend/docs/engine/MEMORY_ENGINE.md#17-memory-a01-indexed-causal-recall-171) применяется без LLM.

| RU | EN | Ожидание |
|---|---|---|
| помнишь прерванную игру | remember when I interrupted the game | A |
| тебе помешали поиграть | remember when you were stopped while playing | A |
| игра завершилась по таймауту | the game timed out | B |
| игра потеряла опору | the game lost its support | C |
| мы завершили игру | we completed a game | D |
| ты одна закончила игру | you finished a game alone | E |
| я коснулся тебя | I touched you | F |
| помнишь игру | remember a game | newest terminal |

Negatives: «чай на столе», “a window title”, «я не прерывал игру», “the game was interrupted and timed out” → no causal query/result (прежний non-causal baseline допускается). Measured baseline report: causal precision@1 и recall@1 на16 positives, no-match false positives на4 negatives, поязыковые результаты и paraphrase subset отдельно; target100%/100%/0 только для этого закрытого корпуса, не general semantic quality. Дополнительно deleted/stale/source-generation rows никогда не возвращаются, examined/fetched≤16/turn, memory deadline≤200ms; замерить p50/p95/максимум времени/работы на указанной машине, таймауты считать omission, не успешным поиском. Если real elapsed выходит из200ms, зафиксировать фактический fail; не расширять threshold ради pass. Эти измерения и сохранённые lexical misses — вход #173, не основание объявить embeddings обязательными заранее.

### 6.2. Языковой delta #174

Дополнить **тот же** набор A–F/старый A/1000 pairs/1000 noise events следующими20 запросами; expected `A` означает именно source user_interrupted, не любой game. `omission` означает отсутствие causal query/result; прежний non-causal baseline разрешён. Все baseline20 сохраняются побуквенно. Каждая RU/EN ячейка — отдельный query. Новая матрица содержит8 positive,8 negative и4 ambiguous; это закрытый проверяемый scope, не обещание общего понимания RU/EN.

| RU | EN | Ожидание |
|---|---|---|
| я не дал тебе закончить игру | I did not let you finish the game | A |
| я не дала тебе закончить игру | I cut your game short | A |
| я оборвал твою игру | I prevented you from finishing the game | A |
| я не позволил тебе закончить игру | I kept you from finishing the game | A |
| я не прерывал твою игру | I did not interrupt your game | omission |
| ты прервала мою игру | you interrupted my game | omission |
| он прервал твою игру | Anna interrupted your game | omission |
| не игра, а чай | not a game, a book | omission |
| мы не закончили игру | we did not finish the game | omission: причина/actor неизвестны |
| вспомни как наше развлечение оборвалось | remember when our round was cut short | omission: нет однозначной causal группы |

Read-only измерение существующего normalizer `615ade1` на этих20 queries:0/8 positives выбрали user_interrupted (4 no-query,4 game.any);4/8 negatives дали несовместимый user_interrupted bucket;4/4 ambiguous дали omission. Это **query-stage observations**, не measured retrieval precision/recall: actual source selection/latency новых20 в #173 не измерены. Полная #172 приёмка исходных20 отдельно дала16/16 positive matches и0/4 negative causal matches; эти результаты не распространяются на новый набор.

До реализации #174 фиксируется минимальный полезный delta: прежние16 positives/4 negatives без регрессий; новые8/8 positives выбирают A,8/8 negatives и4/4 ambiguous дают omission. Precision@1/recall@1 на всех24 positives целевого набора100%; false causal inclusion на всех12 negatives и4 ambiguous —0. Отдельно дать RU/EN, исходный/paraphrase subset, все улучшившиеся/ухудшившиеся case IDs. Если выбранный matcher не проходит пределы, не объявлять upgrade принятым и не поднимать thresholds ради pass.

#174 сохраняет baseline outputs как данные общего synthetic fixture и воспроизводит baseline на source commit `615ade1`; затем измеряет actual whole recall на тех же40 queries и источниках, включая restart/1000 noise history. Отрицание, quoted/compound correction, несовместимый actor/target, stale/deleted/suppressed source и неоднозначность проверяются отдельно; похожие слова не подтверждают факт/мотив. Не писать копию прежнего runtime или отдельный benchmark framework ради сравнения.

Ресурсная приёмка: один прежний read group≤200ms, causal examined/fetched≤16, card postings/payload≤96, прежние2 slots/2400 units/32KiB; без новых reads/индекса/worker job/model. Измерить query-stage и whole-recall p50/p95/max на указанной машине; каждый elapsed>200ms — omission/fail, не successful match. Новые persistent index bytes/startup/rebuild work равны0; статические phrase/guard tables≤4KiB UTF-8, mutable cache/retained query state отсутствует, дополнительная нормализация ограничена240 UTF-16 текущей реплики. Общий RAM/disk existing индексов и их source invalidation не меняются. Crash/corruption/rebuild/missing source используют прежний safe omission #172; unsupported query использует прежний baseline, явный несовместимый clause — только omission. Живое качество речи и generalized semantic quality этими fixtures не подтверждаются.

**Выбор #173.** Альтернативы: baseline сохраняет измеренные phrase/subject ошибки; локальное ограниченное сопоставление адресует их без нового resource lifecycle. Hybrid/semantic retrieval не измерены на этом наборе и не объявлены лучше; similarity сама не разрешает отрицание/actor/source validity, поэтому новый model/store не обоснован. Более широкие перефразирования остаются неподтверждёнными; отдельная технология требует новых measured misses и нового решения. #174 реализует только Domain matcher/guards и существующие quality/lifecycle tests, без wire/schema/CRUD/retention/UI изменений; точные заранее установленные quality/resource acceptance — в corpus.

## 7. MEMORY-A03: несколько наблюдённых UTC-дат и summary событий (#175)

Это target договор #176/#177, не утверждение готовности runtime. Источник — только immutable causal episodes #154; [local
ports](../../frontend/src/application/ports/life-history.interface.ts), [target wire](../../frontend/src/application/ports/backend-life-history-contract.ts),
независимые [Python schemas](../../backend/wisp_backend/api/schemas/life_history.py). Domain проверяет независимость/агрегацию; Application связывает source
proof, общий recall/summary lifecycle и consent; существующий worker выполняет bounded reads. Никаких новых providers/dependencies, фонового inference,
reasoning graph или learning из derived text.

### 7.1. Общее окно источников

Новый rebuildable `causal_history_index` хранит exact source ref/revision1, occurredAt, private insertion order и размер canonical payload только cursor_game
terminals. Index `(occurred_at, insertion_order)` позволяет UTC range read без transcript scan/SQL JSON scan. Canonical append/delete/reset и index изменяются
одной transaction; существующая bounded maintenance обрабатывает не более64 canonical rows за request, с persisted cursor, без poller/tick SQL. До окончания
backfill/loss repair coverage=index_building; derived index не второй source of truth. Invalid index → omission/rebuild, не удаление canonical facts.

Одна worker transaction читает metadata build/clock и до1001 postings диапазона, затем максимум1000 exact canonical payloads. 1001-я запись или serialized
canonical page>1MiB означает coverage=overflow и **пустые events**, не inference по prefix. Metadata хранит максимальный recorded UTC timestamp и
пересчитывается при удалении/исправлении соответствующего source; future source относительно `asOf`, invalid calendar/shape, индекс/source mismatch либо
обнаруженный wall-clock rollback → clock_unknown/whole omission. Постоянный metadata read не count/full-history scan. Общий read group≤200ms, одна in-flight
группа; timeout/storage failure → omission, без расширения cap, retry loop или очереди запросов. Новые offsets/timezone/DST не применяются задним числом.

Окно — максимум14 UTC calendar dates, включая текущую частичную дату, `fromDateUTC..throughDateUTC`, `asOf` — текущий calendar UTC timestamp. Читаются только
occurredAt≤asOf; порядок occurredAt ASC, при равенстве private insertion order ASC, затем exact identity. Даты означают **записанные UTC-метки**, не полные
дни присутствия/личный timezone пользователя. Нет источников в дату — нет evidence, не отказ/AFK/неудача. Invalid/unknown date не восстанавливается из текста
или текущего timezone. После rollback новый derived capture допустим лишь при восстановленной согласованности часов; локальный runtime не ждёт его.

Независимая identity — `(appRunId, sequence, revision1)` плюс unique actual activityRun в том appRun. Legacy game_episodes, другой index, report, recall,
summary и повтор callback того же terminal не второй sample. Source changes/reset проходят существующий synchronous memory generation barrier; время закрытого
приложения не создаёт события. Retention canonical rows остаётся до full reset, автоматический TTL/удаление sources здесь не вводятся.

### 7.2. Один cross-day вывод #176

Категория только `shared_game_completions`: повторение завершений **наблюдённых** совместных cursor games. Полное окно для capture — текущие14 UTC dates по7.1.
Eligible evidence: distinct completed/user_engaged terminals с executedMs≥1000 либо user_interrupted/user_engaged terminals с executedMs≥1000 и trusted user
trigger. Solitary/none, environment loss/timeout, other/unknown и текст модели не positive и не counterevidence пользователя. Они не превращаются в «плохие
отношения».

| Условие текущего полного окна | Результат |
|---|---|
| Completed≥6 и встречаются на≥3 distinct UTC dates; completed/(completed+interrupted)≥0.7; последний eligible terminal completed; среди последних4 eligible меньше2 interruptions | Ровно один tentative completion-pattern с exact counts/датами и source refs |
| Недостаток days/counts, ratio<0.7, последний eligible interruption или≥2 interruptions среди последних4 | No insight; прежний вывод снимается |
| Building/overflow/clock_unknown, missing/invalid source, volatile/storage/timeout | Omission, не отрицательный вывод |

Это versioned техническое правило, не доказательство удовольствия, дружбы, мотива, будущей готовности играть или полного распорядка. Числовые
Character/relationships/preferences/consent, own-interest #160 и activity outcomes не меняются. Разные истории могут давать pattern либо no-insight, но не
социальный диагноз/штраф.

Derived результат хранится только в одном RAM cache с ≤1000 exact source refs, memory generation, source revision и asOf. Startup ничего не
replay-ит/генерирует; первый подходящий ordinary user query заново читает canonical окно. Cache действителен только для того же UTC date/window, текущих
clocks/generation/source revision. Нет отдельного persisted insight payload, обещания successful write или восстановления старого вывода без proof.

`ICausalSourceReadBarrier` — одна revision и один settle wait существующих causal appends. Revision синхронно меняется **до** постановки append в worker и при
invalidation/reset; pending очищается после acknowledged success/failure. Capture один раз ждёт settle в том же200ms budget, затем фиксирует state с
pending=false, читает окно и повторно проверяет revision/generation/pending/date перед dispatch и публикацией. Любой новый append (включая будущий
counterevidence), deletion/correction/reset или clock discontinuity инвалидирует старый RAM result/pending capture. Никаких повторных read в том же opportunity,
SQL на tick, background recompute или нового queue; failure не считается опытом. После timeout новый запрос не создаёт вторую unsettled read group.

Единственный consumer — обычный `/v1/chat`, когда current text existing normalizer даёт game.any либо game.completed.user_engaged. No query match → no insight.
Local proof/capture не помещается в IPC/wire; provider получает только [lifeReflection](BACKEND_MEMORY_CONTRACT.md#13-memory-a03-вывод-о-совместных-играх-175),
без IDs/исходного дневника. Events/touch/observation не получают его и явно отклоняют это поле; не появляется инициативный вопрос/LLM loop. Capture validity
проверяется и после provider result, до публикации; source invalidation не позволяет late reply вернуть старую inference.

### 7.3. Один event-source mode summary #177

Режим `life_events` добавляется к **тому же** controller/interlock/cache/controls summary, отдельно от `dialogue_pairs`. Пользователь явно выбирает UTC
диапазон≤14 dates и видит preview точных4–8 eligible cursor terminal sources; новый режим не маскирует event как user→assistant pair. Из полного окна7.1 берутся
последние8 known-cause terminals, в occurredAt/private insertion chronology. Contact, other/unknown, rejected preview и несохранённый event не подходят. Нет4
sources/неполное окно/нет provider capability → unavailable с понятной причиной, без inference.

Preview содержит реальную chronology/outcome/participation/date и поясняет «выбранные события при работающей Wisp; не вся жизнь». Source IDs остаются
Main/Application; Renderer получает preview ID и semantic entries. TTL120s, current stream/memory generation и отдельное подтверждение передачи выбранных
событий текущему backend/provider. Свободный пересказ не заменяет preview. При offline остаются локальная жизнь/обычный recall и безопасный статус; полноценная
локальная речь от отсутствующей модели не обещается.

`POST /v1/summary` принимает одну из двух exact форм: прежние `{requestId,locale,stream:false,pairs}` **без изменений** либо target
`{requestId,locale,stream:false,fromDate,throughDate,events}`. Shapes взаимно исключаются: pairs+events/null/extra keys отклоняются до admission. Это единый
Alpha contract, без version field/probe/adapter/нового endpoint. Event array4–8 в chronology; UTC dates calendar-valid, inclusive span≤14 и каждый occurredAt
внутри него. Event fields — target BackendLifeSummaryEvent; only cursor_game, coherent known terminal cause/outcome/actor, finite executedMs0..600000.
IDs/appRun/run IDs/revisions/raw dialogue/исходная summary/Character/settings/instructions не передаются. Array position — request-local ordinal, mapping exact
refs хранит client.

Structured event request≤8KiB и общий32KiB cap; source data обязательны целиком, не truncate ради бюджета. Summary scenario использует прежние8192 budget
units/output≤512 provider tokens, server10s/transport12s/runtime15s, одна generation, никаких repair pass/failover/tools/extraction. Prompt source-only:
даты/исходы/участие лишь как записаны, unknown не достраивать, не объявлять мотивы/эмоции/вкус/авторскую биографию/«всегда» или полную coverage. Нет style
examples/нового характера. Events untrusted user-role JSON, технический provenance отдельно. Формат ответа остаётся exact `{requestId,text}`, text1..1200
UTF-16/response≤16KiB. Форматная проверка и source proof **не доказывают** истинность свободного LLM текста; он остаётся помеченным derived/unverified, не
evidence. Live качество отдельно, без paid calls в automated tests.

До dispatch durable receipt и exact revalidation всех4–8 refs; после ответа, перед save и каждым chat capture — exact resolveSources≤8 в общем200ms budget и
SHA-256 canonical source payload/identity/revision. Missing/corrected/deleted source/digest/generation mismatch → stale, не cache save/send. Same command joins
pending/result, другой payload/mode с тем же ID конфликтует. Одна глобальная принятая попытка rolling24h на профиль **для обоих режимов**, включая
errors/timeout/unknown outcome; no retry/background call. Cache hit того же sourceDigest/locale/generatorVersion после validation возвращает text без inference.
Новые append не меняют выбранные immutable sources: summary остаётся историей именно frozen preview, не current trend7.2.

### 7.4. Cache, chat inclusion и удаление

Один прежний `summary-cache.json`, максимум32KiB/одна entry/один общий receipt, target formatVersion2. Strict format1 migration только локальная: старые
entry/receipt получают mode=dialogue_pairs, hashes/locale/generatorVersion1/admittedAt сохраняются дословно; writer затем толькоformat2. Life entry/receipt
mode=life_events/generatorVersion2, sourceDigest включает mode/locale/UTC range/ordered exact refs+payload digests. Cache не копирует raw source payload.
Никаких wire versions/legacy transports. Corrupt/future format fail closed, не повреждает SQLite и не сбрасывает frequency receipt/не разрешает новый paid call.
Старый binary не переписывает неизвестный format.

Life cache capture разрешён только ordinary chat при current game query и valid exact sources. В тот же optional `summary` field передаётся target
`{sourceKind:life_events,text,fromDate,throughDate,eventCount}`; прежняя `{text}` ветка dialogue_pairs остаётся прежней. Оба режима summary одновременно не
передаются, summary не попадает в events/touch/observation. Если life summary выбран, lifeReflection целиком omitted; иначе reflection может участвовать по7.2.
При inclusion exact covered causal refs и equivalent legacy game run IDs исключаются из recall, как dialogue coverage исключает свои message IDs. Не исключать
другие verified события, не увеличивать2 episode slots/2400 memory units/32KiB body/token ceiling. Whole optional drop при byte/provider overflow, без
вытеснения immutable baseline state/facts/current input. Chat/startup/timer никогда не создают summary inference.

Любой turn, которому фактически dispatch-нут lifeReflection или life summary, получает Main-owned `LifeDerivedContextUse`. Append пары+suppress этой пары для
future raw recall/summary/extraction — одна прежняя worker transaction, включая fallback output. Request/user/assistant binding/digest препятствуют
bound/unbound replay, как existing topic/beverage use; не выводить use из текста LLM/Renderer. Current явная user-реплика сохраняет прежний recognizer, но model
paraphrase/новый summary не становятся causal source или новым подтверждением pattern. Это flat use/suppression, не новый source graph. Уже показанная
историческая реплика не считается новым событием/актуальным cache.

Source correction/delete, full reset и существующие memory mutations синхронно закрывают admission/abort/инвалидируют captures/cache **до** SQL barrier;
rollback не оживляет callbacks. Counterevidence append инвалидирует current reflection, но не переписывает immutable выбранный sample старой summary. «Удалить
сводку» удаляет entry text/coverage и сохраняет общий24h receipt/источники; UI не обещает удалить source history, уже отправленный backend/provider payload либо
произвести full reset. Full reset очищает cache/temporary files/receipt/index/state одной прежней cleanup workflow; late writer запрещён. Dialogue reset/reload
abort preview/generation, durable cache/receipt остаются; restart лишь revalidates, dispose завершает queue без late save. Старые association/suppression IDs
остаются до full reset, тексты не логируются. Server storage не добавляется: inference lifetime/RAM response cache≤10min/provider retention и общие ledger TTL
остаются прежними.

### 7.5. Конечные проверки разработчика

#176: synthetic sufficient histories на3+ UTC dates против duplicates/same-date/solitary/unknown/missing sources; ratio70%, latest/out-of-last4 counterevidence boundaries; timezone/DST не меняет recorded UTC grouping, future/rollback/building/1001 rows/1MiB/200ms дают omission. Capture-before-append-ack, new counterevidence during read/provider wait, failed append, source correction/delete/reset/restart/dispose и no replay/learning. Ordinary chat only, exact TS/Python root-field fixtures, optional atomic drop/auth/outage/malformed/timeout/late result, actual derived-use pair suppression/no echo.

#177: pairs mode unchanged; life4/8 sources/range14/chronology/ties/dedup/unknown cases, preview120s/explicit consent, one global receipt across modes, duplicate/conflict/lost write/clock rollback, format1→2 preserves receipt, future/corrupt cache safe. Actual source→generation→restart→1000 later events→matching chat without duplicated source; correction/delete/reset/late generator/filewriter/consumer pair echo. Shared valid/invalid fixtures under `desktop-backend-v1/life-history`, both providers mocked; no private corpus/live-quality claims. Проверить typecheck, affected backend schemas/tests и общий integration gate через existing tooling, scoped pre-commit. Нового QA/benchmark framework нет.
