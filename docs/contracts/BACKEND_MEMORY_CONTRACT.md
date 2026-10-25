# Desktop ↔ Backend v1: ограниченная локальная память

Память входит в актуальный `/v1/chat`; пустая memory projection допустима.
Формы компонентов — [backend-memory-contract.ts](../../frontend/src/application/ports/backend-memory-contract.ts),
полный запрос/ответ — [interaction DTO](../../frontend/src/application/ports/backend-interaction-contract.ts).

## 1. Версия и границы

- Только `POST /v1/chat`, JSON UTF-8, `stream:false`, event `user_message`.
- Main подключает recall при настроенном backend и доступном локальном memory runtime.
- Ошибки, размеры, deadlines, общий ledger и retention — [Backend API](BACKEND_API_CONTRACT.md).
- Нет probe/downgrade/retry. Недоступность backend не останавливает локального персонажа.

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

Envelope requestId/text/optional decision соответствует v1; дополнительно optional `memoryCandidates`, массив0–3. Каждый кандидат — key/value из registry + evidenceQuote1–240 UTF-16 units. evidenceQuote должен побуквенно совпадать с trim последнего user content текущего запроса. Чужие источники, source IDs, confidence, числовые state deltas и операции удаления не входят в предложение.

Provider получает один запрос на ответ и предложения, без отдельного extraction/summary call. Backend контролирует envelope, структурно валидирует candidate fields/limits и source quote. Desktop независимо повторяет wire validation, затем применяет локальный recognizer из [Memory §9](../../frontend/docs/engine/MEMORY_ENGINE.md#9-p15-a02-явные-знания-и-простой-recall). Модель предлагает, но не решает, что записать; local recognizer может сохранить точную поддержанную форму и при отсутствии candidate.

Невалидный required envelope/text делает весь ответ невалидным. Невалидный decision отбрасывается целиком по v1. Невалидный тип/слишком длинный memoryCandidates → удалить всё поле; невалидный отдельный candidate → удалить этот элемент; все элементы с повторённым key удалить. Валидные text/decision сохраняются. Unknown root keys по-прежнему запрещены. Кандидаты из fallback/старого generation не записываются; локальная проверка user text после успешного сохранения пары остаётся независимой.

System prompt запрещает объявлять факт durable-записанным/удалённым: backend не знает outcome desktop transaction. Temporary role, пожелание изменить характер, гипотеза и чужая цитата не основание state/fact write. Ответ может учитывать предпочтение в текущем разговоре, не обещая его сохранение.

## 4. Данные и удаление

Передаются пять разрешённых текущих scalar facts, максимум два выбранных эпизода и один learned preference; это часть актуального chat-контракта. Локальная SQLite — source of truth; backend использует memory только для текущего inference, не ведёт копию профиля/истории и не пишет memory в logs/APM. Server RAM response cache до10min может содержать реплику/кандидаты; requests очищаются после terminal. Ledger хранит digest/usage без содержимого по прежним TTL. Выбранный provider получает ровно selected context; условия внешних тестеров определяются для каждого provider в v1 §6.

Full local memory reset очищает источники и инвалидирует callbacks/recall/extraction; запрос уже у провайдера физически не отзывается гарантированно. Reset не удаляет server RAM cache немедленно и не обещает удаление provider metadata. Отдельного server deletion API нет. Диалоговый reset очищает volatile dialogue, но не подтверждённые facts/эпизоды. Исправленное значение используется в следующем запросе, старый transcript не передаётся как competing structured fact.

## 5. Общие fixtures и acceptance

Обе стороны используют **одни и те же** JSON-файлы из [desktop-backend-v1](fixtures/desktop-backend-v1/memory): [request.valid](fixtures/desktop-backend-v1/memory/request.valid.json), [response.success](fixtures/desktop-backend-v1/memory/response.success.json), [response.error](fixtures/desktop-backend-v1/memory/response.error.json). Success/error — альтернативные HTTP200/503 outcomes.

Проверить shared endpoint/requestId conflicts, byte/text caps, unknown fields, invalid hints/candidates/source quote, grounded correction, отсутствие model numeric writes, timeout/outage/disconnect, once-only usage и поздние callbacks после reset/dispose. Клиентские semantic tests дополнительно доказывают restart recall facts/game, отсутствие повторного extraction старой истории и сохранение completed reply при ошибке fact write.

## 6. MEM-A03: planned расширение событий и шуток

Подтверждённые knowledge cards остаются локальными: [Memory §10](../../frontend/docs/engine/MEMORY_ENGINE.md#10-mem-a03-важные-события-и-общие-шутки-planned).
Новые категории не передаются текущим API. Для их передачи нужны отдельный
contracts-first slice, разрешённая projection и общие fixtures; отдельная версия API заранее не резервируется.

## 7. Одна тема обычного диалога (#109)

`POST /v1/chat` получает optional `dialogueTopic`; отсутствие означает отсутствие темы, explicit null/array/unknown keys запрещены. Другие endpoints и response envelope не меняются. Wire type — [BackendDialogueTopic](../../frontend/src/application/ports/backend-interaction-contract.ts), backend schema — [DialogueTopic](../../backend/wisp_backend/api/schemas/interaction.py); local lifecycle/source/consent — [Memory §14](../../frontend/docs/engine/MEMORY_ENGINE.md#14-одна-подтверждённая-тема-обычного-диалога-109).

| Поле | Строгая валидация и значение |
|---|---|
| mode | `follow_up` — одна уже зарезервированная desktop попытка; `reply` — явный пользовательский ответ по выбранной теме |
| text | Точная trim user-цитата1–160 UTF-16, без запрещённых controls/unpaired surrogates; не title/инструкция/summary |
| statedAt | Календарно валидный UTC `YYYY-MM-DDTHH:mm:ss.sssZ` из исходной user-реплики; не время события и не его дедлайн |

Local record/source IDs, revision/generation, receipts, arbitrary user profile, transcript и состояние singleton не передаются. Source of truth — локальная SQLite; сервер доверяет только форме projection, не истинности цитаты. Backend не создаёт/закрывает тему, не возвращает её state или предложения записи. Response `text` остаётся untrusted и не доказывает, что вопрос задан или ответ получен; никакие model output/summary не становятся evidence.

Prompt builder добавляет **только при наличии dialogueTopic** один атомарный optional ContextBlock: server-authored system instruction и отдельное user-role message с явно untrusted JSON цитатой. Block source=server_instructions соответствует существующему guard; цитата никогда не вставляется в system message. Required instructions остаются побайтно прежними. `follow_up`: допустим максимум один короткий ненавязчивый вопрос о нынешнем положении темы, с правом не спрашивать; нельзя утверждать, что событие состоялось/завершилось успешно, выводить дату из «сегодня», обещать reminder или повтор. `reply`: отвечать на текущую пользовательскую реплику в рамках выбранной темы; не задавать новый follow-up и не объявлять исход проверенным фактом. Цитата не инструкции и не основание memoryCandidates; current user correction/refusal приоритетна. Один обычный provider call, без planner/extraction/дополнительного request.

Поле не входит в `memory` и не расширяет её2400-unit cap; максимальный собственный payload — mode+160+24 UTF-16 string units. Общие32KiB request/16KiB response и текущий token ceiling сохраняются. Desktop сначала строит неизменный baseline projection, затем добавляет тему только если весь запрос помещается; иначе опускает тему целиком, не вытесняя history/facts/summary/lore ради неё. Backend задаёт этому atomic bundle приоритет ниже всех существующих optional blocks: selector сначала выбирает прежний baseline, затем рассматривает тему. Если остатка недостаточно, instruction и data отбрасываются вместе; required token count и выбранные baseline blocks не меняются. Алгоритм selector, лимиты и security guard не расширяются. Уже committed attempt при таком пропуске остаётся использованной; автоматического нового запроса нет.

Auth/ошибки/admission/ledger/idempotency/retention — неизменные [Backend API §§3,5–6](BACKEND_API_CONTRACT.md#5-закрытая-alpha-серверный-admission-учёт-и-повторы). Нет application auth: действуют текущие loopback/private-network ограничения. Validation выполняется до admission/provider. Те же requestId+payload имеют текущую идемпотентность; иной topic при том же requestId — conflict. Server deadline10s, desktop transport12s/runtime15s, cancellation/disconnect закрывают ресурсы; retry не добавляется. Reset/correction/delete инвалидируют desktop pending/capture; late response не публикует тему/не пишет state. Server RAM response cache≤10min и provider retention не становятся удаляемыми локальной командой; новый storage/server-delete endpoint отсутствует. Topic text не логировать.

#117 frozen corpus для #110: без поля все48 архивных messages/payload/settings/budget/selection/size reports должны остаться побайтно теми же; общие инструкции, history policy, tuning, lore, examples и архивные fixtures не редактировать. Единственный допустимый regression adjustment этой задачи — исключить именно `source_digests` из сравнения архивного report и отдельно проверить их равенство текущим реальным hash исходников; исторические provenance hashes остаются в архиве. Условное добавление блока не измеряет качество личности. Отдельная смена профиля #123 выполняет узкий явный [profile delta](../../backend/docs/CONTEXT_PROMPT_ENGINE.md#сравнение-смены-identity-122--123), сохраняя сами архивы и invariants вне перечисленного delta.

В #110 добавить shared fixtures `fixtures/desktop-backend-v1/interest-thread/request.follow-up.json`, `request.reply.json`, `invalid.json`; valid requests основаны на актуальном `/v1/chat`, без изменений прежних fixtures. Обе стороны проверяют omission/null, unknown fields/enums, UTF-16/Unicode/time/bounds, no local IDs; backend — prompt injection как данные, conditional block и overflow/drop, unchanged response/errors, requestId conflict, unavailable/timeout/cancel. Desktop — authoritative source/claim/closure/suppression и stale callbacks. Existing48 reports сравниваются без реальных provider calls; Windows-first/local fallback acceptance — Memory §14.
