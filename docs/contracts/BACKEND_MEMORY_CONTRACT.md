# Desktop ↔ Backend v2: ограниченная локальная память

Явное совместимое расширение рядом с v1, решение [P15-A02 #55](../archive/P15_A02_RESULT.md). Формы — [backend-memory-contract.ts](../../frontend/src/application/ports/backend-memory-contract.ts); imports только из автономных v1 wire types. Клиентская реализация связана с #56; фактические возможности сервера в `backend/` перечислены в [серверном навигаторе](../../backend/docs/README.md). Наличие этого документа не означает доступность `/v2/chat` на сервере.

## 1. Версия и границы

- `POST /v2/chat`, `version:2`, JSON UTF-8, `stream:false`, event только `user_message`. `/v1/chat` и его fixtures не меняются и по-прежнему отвергают memory/новые поля.
- Main явно выбирает provider API version1 или2 из доверенной конфигурации; default1 сохраняет #54. Нет автоматического probe, downgrade, повторного LLM или fake user events. v2 404/unsupported/unavailable — обычный safe fallback, локальная жизнь продолжается.
- Поля character/messages/locale/ID и весь HTTP/error dictionary имеют прежнюю семантику [v1 §1–3](BACKEND_API_CONTRACT.md#1-транспорт-и-владение), кроме version2. Request ≤32 KiB, response ≤16 KiB; UTF-16 text limits и exact-shape сохраняются. `requestId:null` допустим только для нераспознанного/невалидного ID в ошибке.
- Wrong version на `/v2/chat` → HTTP400 `unsupported_version` с envelope version2; аналогично `/v1/chat` отвечает собственной version1. Ошибку протокола нельзя принимать за успешный memory response.
- Closed-network access, общие deployment budgets, UTC accounting, cancellation/deadline10s и retention остаются [v1 §5–6](BACKEND_API_CONTRACT.md#5-закрытая-alpha-серверный-admission-учёт-и-повторы). Ledger общий для обеих версий и `/v1/touch`; digest включает method+path+точные body bytes. Повтор ID на другом endpoint →409 conflict, а не вторая бесплатная генерация. Прежний body-only digest сопоставляется только на `/v1/chat`, никогда на touch/v2/v3; legacy records сохраняют прежний TTL.
- 200ms desktop recall входит в прежний15s runtime deadline; adapter timeout12s от fetch start сохраняется. Нет auth, server memory, tools, scheduler, файлов, экрана или новых игровых сетевых событий.

## 2. Разрешённая memory projection

`memory` — обязательный объект с тремя обязательными массивами; пустые массивы — корректный degraded/пустой context. В него входят только локально отобранные данные, не полный SQLite dump. Local source IDs/session IDs/generation и schema/SQL не передаются.

| Поле | Валидация |
|---|---|
| `facts` | 0–5 уникальных registry keys из wire type; value непустой plain text: display_name/preferred_address ≤80, favorite_topic ≤120 UTF-16; reply_style строго brief/detailed, cursor_game строго like/dislike |
| `episodes` | 0–2 записей, из них ≤1 cursor_game; неизвестные варианты/поля запрещены |
| dialogue episode | userText 1–240, assistantText 1–400 UTF-16; occurredAt — календарно валидный UTC `YYYY-MM-DDTHH:mm:ss.sssZ` |
| cursor_game episode | Только реальный сохранённый playCompleted episode; outcome по wire enum; executedMs finite ≥0 и ≤60000; occurredAt как выше; координаты/участие пользователя не выводить из outcome |
| `characterPreferences` | 0–1 запись с key activity.cursor_game; value finite −100..100, confidence finite0.5..1; это learned Character affinity, не user fact |

Все memory text values вместе ≤2400 UTF-16 units: рекурсивная сумма всех string values внутри memory, включая registry key values, enum values и timestamps, без имён JSON properties. Числовые строки/booleans вместо чисел не принимаются. Остальной byte budget учитывает JSON escaping: если полный запрос не помещается, desktop убирает ranked episodes, затем прекращает отправку при всё ещё невалидном размере; ядро personality и текущий user text не сокращаются ради памяти. Пустая память не позволяет убрать обязательный memory object.

Backend включает memory в отдельный **untrusted context** блок. Precedence: system instructions → текущая явная пользовательская correction → актуальные registry facts → recalled episodes; это приоритет фактического контекста, не право user/memory менять system instruction. Старые эпизоды не доказывают нынешние предпочтения. Character projection всегда передаётся отдельно; модель не обещает знания о несохранённых/непереданных событиях.

## 3. Ответ и extraction

Envelope version/requestId/text/optional decision соответствует v1; дополнительно optional `memoryCandidates`, массив0–3. Каждый кандидат — key/value из registry + evidenceQuote1–240 UTF-16 units. evidenceQuote должен побуквенно совпадать с trim последнего user content текущего запроса. Чужие источники, source IDs, confidence, числовые state deltas и операции удаления не входят в предложение.

Provider получает один запрос на ответ и предложения, без отдельного extraction/summary call. Backend контролирует envelope, структурно валидирует candidate fields/limits и source quote. Desktop независимо повторяет wire validation, затем применяет локальный recognizer из [Memory §9](../../frontend/docs/engine/MEMORY_ENGINE.md#9-p15-a02-явные-знания-и-простой-recall). Модель предлагает, но не решает, что записать; local recognizer может сохранить точную поддержанную форму и при отсутствии candidate.

Невалидный required envelope/text делает весь ответ невалидным. Невалидный decision отбрасывается целиком по v1. Невалидный тип/слишком длинный memoryCandidates → удалить всё поле; невалидный отдельный candidate → удалить этот элемент; все элементы с повторённым key удалить. Валидные text/decision сохраняются. Unknown root keys по-прежнему запрещены. Кандидаты из fallback/старого generation не записываются; локальная проверка user text после успешного сохранения пары остаётся независимой.

System prompt запрещает объявлять факт durable-записанным/удалённым: backend не знает outcome desktop transaction. Temporary role, пожелание изменить характер, гипотеза и чужая цитата не основание state/fact write. Ответ может учитывать предпочтение в текущем разговоре, не обещая его сохранение.

## 4. Данные и удаление

Передаются пять разрешённых текущих scalar facts, максимум два выбранных эпизода и один learned preference; это дополнение к составу v1, выбранное только в режиме v2. Локальная SQLite — source of truth; backend использует memory только для текущего inference, не ведёт копию профиля/истории и не пишет memory в logs/APM. Server RAM response cache до10min может содержать реплику/кандидаты; requests очищаются после terminal. Ledger хранит digest/usage без содержимого по прежним TTL. Выбранный provider получает ровно selected context; условия внешних тестеров определяются для каждого provider в v1 §6.

Full local memory reset очищает источники и инвалидирует callbacks/recall/extraction; запрос уже у провайдера физически не отзывается гарантированно. Reset не удаляет server RAM cache немедленно и не обещает удаление provider metadata. Отдельного server deletion API нет. Диалоговый reset очищает volatile dialogue, но не подтверждённые facts/эпизоды. Исправленное значение используется в следующем запросе, старый transcript не передаётся как competing structured fact.

## 5. Общие fixtures и acceptance

Обе стороны используют **одни и те же** JSON-файлы из [desktop-backend-v2](fixtures/desktop-backend-v2): [request.valid](fixtures/desktop-backend-v2/request.valid.json), [response.success](fixtures/desktop-backend-v2/response.success.json), [response.error](fixtures/desktop-backend-v2/response.error.json). Success/error — альтернативные HTTP200/503 outcomes. V1 fixtures остаются неизменными и продолжают проходить.

Проверить обе версии одновременно, mixed endpoint/requestId conflicts, byte/text caps, unknown fields, invalid hints/candidates/source quote, grounded correction, отсутствие model numeric writes, timeout/outage/disconnect, once-only usage и поздние callbacks после reset/dispose. Клиентские semantic tests дополнительно доказывают restart recall facts/game, отсутствие повторного extraction старой истории и сохранение completed reply при ошибке fact write.

## 6. MEM-A03: planned расширение событий и шуток

Решение [#65 / ARCHITECT RESULT](../MEM_A03_RESULT.md), локальная семантика — [Memory §10](../../frontend/docs/engine/MEMORY_ENGINE.md#10-mem-a03-важные-события-и-общие-шутки-planned). **Будущий контракт**, не реализованные route/types/fixtures. §1–5 и действующие v1/v2/v3 формы остаются неизменными; перенос backend #62–64 не включает v4. Ни новый enum variant в v2/v3, ни превращение шутки в обычный dialogue episode не являются совместимым способом включения.

### Версия, admission и rollout

`POST /v4/chat`, version4: прежний [v3 chat](AI_EVENTS_CONTRACT.md#5-явный-wire-v3-и-данные) с optional `previousInitiative` и расширением только memory. Событие по-прежнему только `user_message`, stream=false, текущая locale/character/messages/ID validation. Endpoint ошибочной версии возвращает HTTP400 unsupported_version/envelope4; success/error envelope тоже version4. Request≤32KiB, response≤16KiB, exact-shape и запрет unknown fields сохраняются. Поля enum/category не принимают coercion.

Явная доверенная Main-конфигурация следующего slice — chatVersion4 + eventVersion3, прежний `eventsEnabled` по умолчанию false; touch остаётся v1. При eventsEnabled=true существующий v3 event adapter/interlock/request control сохраняется, а v4 chat получает once-only previousInitiative (60s/current generation) как v3. Это planned расширение условия Main composition из AI events §2; оно не изменяет `/v3/events`, causal gates, text-only response или event бюджеты. Для events project только старые v2 memory categories с заполнением baseline slots, без утечки новых items/их sources. Выбор chat4 не должен молча выключить инициативы или потерять их follow-up context.

Recall200ms входит в runtime15s; chat fetch12s/server10s/body2s остаются прежними. Общие client/server quotas, closed-network access без application auth, endpoint-aware ledger/digest, at-most-once usage, cancellation и safe error mapping — [v1 §3/§5](BACKEND_API_CONTRACT.md#5-закрытая-alpha-серверный-admission-учёт-и-повторы). Идентичный ID на другом method/path/body →409 conflict, не новая квота. Автоматических retries, probe и downgrade/failover нет. V4 404/unsupported/outage/timeout даёт обычный безопасный dialogue fallback, локальная память/жизнь остаются доступны; поздний ответ после mutation/reset/dispose отбрасывается.

Сначала совместимые v4 schemas/projection/общие fixtures на fake transport с обеих сторон; затем явное включение. До этого default и существующие выбранные v1–v3 modes не меняются. Локальный knowledge slice может поставляться раньше; это не разрешает отправлять новые поля в старый endpoint.

### Projection и обе стороны validation

Обязательный memory object и массивы facts/episodes/characterPreferences сохраняются. Facts — ровно пять текущих wire keys §2 (local-only Character keys не добавляются), preference — прежний cursor_game. Episodes≤2 суммарно, cursor_game≤1; прежние dialogue/cursor_game сохраняют свои точные формы. Два новых exact варианта:

| Variant | Поля и валидация |
|---|---|
| `important_event` | kind; label1–80 и text1–400 plain UTF-16; confirmedAt — календарно валидный UTC `YYYY-MM-DDTHH:mm:ss.sssZ`; optional occurredOn — календарная дата `YYYY-MM-DD` |
| `shared_joke` | Те же поля, собственный kind; текст цитаты общей шутки не является буквальным утверждением о мире |

Отсутствующая occurredOn не заменяется confirmedAt; null не является отсутствием. Source message/item/command IDs, evidence, revision, tokens, suppression, withdrawn items и raw transcript вне выбранных dialogue episodes **не передаются**. Desktop читает current active revision и исключает source pairs по Memory §10; backend независимо проверяет exact type/limits/category/date, но не утверждает, что лично проверил реальность события.

Все string values memory суммарно≤2400 UTF-16, включая kind/label/text/dates/key/enums, имена JSON properties не считаются; общий byte cap учитывает escaping. Desktop сначала убирает последние ranked episodes, без усечения подтверждённого текста/скрытого удаления facts или ядра; всё ещё oversized request отклоняется до fetch. Backend возвращает invalid_request при нарушении budget, не обрезает payload самостоятельно. Пустые arrays допустимы при degraded recall; память не вызывает дополнительный provider call.

Backend строит один untrusted context block: system restrictions → текущая explicit correction → current scalar facts/confirmed item revision → raw recalled dialogue/previousInitiative. В этой иерархии пользовательские сведения не переопределяют system. Important event атрибутируется утверждению пользователя; joke — общей цитате с её контекстом. Оба вида не доказывают текущую эмоцию, affinity, согласие на действия или достоверность всех слов в шутке. В prompt явно запрещены durable-save/delete claims, выдуманные даты/участники и повтор старой revision как актуальной.

V4 response — прежний v3 chat response с version4: text и optional decision/scalar `memoryCandidates` по §3. **Новых event/joke candidates или mutation instructions нет**: authority — отдельная локальная пользовательская команда. Исходный scalar recognizer/evidenceQuote применяется независимо; selected memory, previousInitiative и model text не являются его источником. Malformed required envelope/text отклоняет response; malformed optional candidates/hints отбрасываются по прежним правилам, валидный reply сохраняется. Один upstream call; runtime/schema обеих сторон реализуются отдельными задачами из результата.

### Данные, удаление и acceptance

Разрешённое дополнение передачи — максимум два выбранных active user-confirmed items в существующем лимите episodes. Локальная SQLite остаётся единственным durable owner. Backend не хранит профиль/историю и не логирует context/quotes/prompts; request очищается после terminal. RAM response cache≤10min, ledger IDs≤24h/aggregates≤30d, metadata logs≤7d и внешняя provider-data/private access проверка — [v1 §6](BACKEND_API_CONTRACT.md#6-данные-сроки-хранения-и-удаление). Уже отправленный контекст обрабатывается провайдером по этому режиму, отдельной серверной копии item нет.

Correction/withdraw/delete инвалидирует local in-flight owners и исключает payload/source pairs из следующих projections; уже отправленное физически не отзывается гарантированно. Удаление карточки сохраняет transcript локально с suppression (§10.2), полный reset очищает оба; никакой из них не обещает немедленного удаления server RAM/provider metadata. Нового server-delete endpoint и обещания «забыто везде» нет.

Общие будущие fixtures `fixtures/desktop-backend-v4/`: valid обе категории, optional-date/empty/degraded memory, previousInitiative follow-up, success/error, границы UTF-16/bytes/dates и invalid unknown/overbudget поля. Оба validators используют один corpus; v1/v2/v3 fixtures продолжают проходить и отвергают новые categories. Client tests проверяют Memory §10.5 и event3/chat4 shared budgets/preemption; backend — boundary rejection до LLM, mixed-ID conflict, один call/usage, timeout/disconnect/malformed/late result. Появление этого раздела не доказывает наличие этих fixtures или endpoint сейчас.
