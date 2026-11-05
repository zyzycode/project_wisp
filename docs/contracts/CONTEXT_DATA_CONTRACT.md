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
