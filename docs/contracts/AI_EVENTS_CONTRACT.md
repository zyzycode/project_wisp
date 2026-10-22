# P17-A04: игровые события и AI-инициативы

Canonical contract для [#58](https://github.com/zyzycode/project_wisp/issues/58); реализация — #59 и отдельная server v1 задача. Локальные механики [cursor-game](../../frontend/docs/engine/ACTIVITY_ENGINE.md#17-cursor-game-v1) и [SocialBid](../../frontend/docs/engine/AUTONOMY_ENGINE.md#13-auto-a09-локальная-жизнь-и-ненавязчивость) не ждут сеть и сохраняют владельцев/пределы. Эта функция добавляет короткую речь и ограниченное использование уже выученного предпочтения, без новых сенсоров/игр/графики.


## 1. Минимальный scope автономных событий и владение

| Допустимое автономное событие | Источник и цель |
|---|---|
| `cursor_game_completed` | Реальный completed terminal текущего run, playCompleted=true, outcome caught/missed/lost_target; тот же GameEpisode уже подтверждён SQLite. Одна необязательная короткая реплика об этом исходе/общей истории |
| `social_bid_started` | Уже начавшийся локальный SocialBid после его обычного Character gate и расходования existing InitiativeBudget. Одна необязательная контекстная фраза в дополнение к жесту |

Cancelled/failed run, admission без start, gaze, курсорные samples/retarget, physics frames, Needs ticks, sleep/wake, idle/return пользователя и startup сами модель не вызывают. Pulse лишь исполняет существующие causal deadlines, не ищет повод обратиться к LLM. Один source run даёт не более одного запроса каждого разрешённого типа; game и social относятся к разным family.

Результат событийного provider — **только text**. Нет decision, memoryCandidates, числовых deltas, tools или нового provider-owned Activity. Физический исход остаётся desktop fact; сервер получает его, а не предлагает заменить. Character/Activity/память не меняются от публикации AI-фразы, `provider_response` stimulus не создаётся. Нельзя выдавать caught за доказанное удовольствие/социальное участие пользователя.

Application владеет event lifecycle/current IDs/generation и admission; Domain — gates, локальная вероятность выбора и невмешательство в P0–P2; Infrastructure/Main — транспорт/abort/DI. Типы: [semantic events](../../frontend/src/application/ports/ai-event-provider.interface.ts), [wire v1](../../frontend/src/application/ports/backend-events-contract.ts), [IPC speech](../../frontend/src/shared/ipc-contracts.ts). Нового IPC command или callback от Renderer для модели нет.

## 2. Транспорт и приоритет пользователя

Все v1 обращения одного Main используют общий транспорт, максимум один текущий запрос. Локальных minute/hour/session квот, резерва для диалога, startup delay и минимального интервала между AI-событиями нет.

Учёт использования backend описан в [§5](BACKEND_API_CONTRACT.md#5-закрытая-alpha-серверный-admission-учёт-и-повторы) и не блокирует запросы по квотам. Настройки провайдера не передаются в Renderer.

Сеть автономных событий включается через `eventsEnabled=true`; default false. Версия API не выбирается. Нет event polling, автоматических retries, запроса на каждый local fallback, запроса на «проверить бюджет» или failover к другой модели. Один pending event timer/request/speech owner, без очереди будущих инициатив; новый competing event пропускается.

Эти условия относятся к автономным game/social событиям. Явное касание пользователя имеет отдельный v1 путь и admission из §8.

Прямой user chat важнее event: admission пользовательского turn сохраняет действующий receipt/15s deadline, отменяет pending event/его speech и abort-ит event transport. До generateResponse runtime ожидает `IAIEventInterlock.interruptForUser()` — settlement **старого HTTP promise**, без второго параллельного fetch. Это один уже принятый user turn, не очередь инициатив. Event adapter обязан settle после abort и во всех случаях не позже собственного3s timeout; поздний результат уже invalid. Если user turn к settlement retired/reset/expired, generateResponse не вызывается. Input/drag/Brain ticks ожидание не блокирует. `canSubmit` не становится false только из-за автономного event. Локальных rate/session/cooldown блокировок нет.

## 3. Causal deadlines, quiet и игнорирование

### Игра

Дедуп-ключ — `(appRunId, activityRunId, memoryGeneration)`, связанный с actual Activity terminal. `IGameEpisodeCommitObserver` вызывается после append acknowledgement; успешный idempotent no-op может повторить callback, поэтому observer независимо дедуплицирует. `GameEpisode.outcome` недостаточен для доказательства completed run: сверить `ActivityOutcomeFeedback.outcome=completed` и тот же run. Cancel после play phase может сохраниться в БД, но не запускает event.

Время T — реальный terminal monotonic time. Подтверждение записи должно прийти до T+2000ms; на T+2000ms планируется **одна** causal попытка, после существующей локальной outcome speech. При callback now≥T+2500ms, отсутствии ack, новом user interaction/game/SocialBid или потере gates — пропуск без позднего catch-up. Старую speech не задерживать/не заменять и terminal не продлевать. Это новый короткий комментарий после непосредственной реакции, не повтор physical outcome effect.

### SocialBid

Триггер сразу после реального started и existing budget.start; request не выбирает/не задерживает жест или его4s wait. Reply разрешён только пока тот же SocialBid ещё active и исходные gates действуют; completed/cancelled/failed до reply → discard. Deadline Activity не продлевается ради AI. Переход к обычному локальному следующему занятию не откладывается.

### Общие gates

Перед recall, transport и публикацией: current stream/conversation/dialogue-generation/memory-generation, events enabled, !quiet/!menu/!disabled, awake без P2 sleep/critical overload, нет P0/активного P1/forced physics, нет user dialogue thinking. Нет начавшегося нового conflicting run. Root/controller подтверждает source identity, не boolean от Renderer/provider.

Recall максимум200ms по [Memory §9](../../frontend/docs/engine/MEMORY_ENGINE.md#9-p15-a02-явные-знания-и-простой-recall); сбой даёт пустую memory projection, не дополнительный запрос. Для игры локальный search text «игра курсор»/`cursor game`, для social — current favorite_topic, иначе пустой query. Это internal retrieval query, **не** искусственное сообщение пользователя. Actual event передаётся отдельно, не зависит от попадания source episode в recall.

Event runtime deadline3500ms от causal admission (включая recall), transport timeout3000ms, server deadline2500ms включая body budget500ms. Результат ровно на deadline уже поздний. Если invalidation случилась после send, cancel+once-only settlement, без publication/history writes; остановка вычисления и списания у провайдера физически не гарантируется. Сервер при неизвестном usage удерживает reservation как прежде. Errors/timeouts молча оставляют локальный жест/игру, без технической error bubble и без LLM fallback call.

Quiet/menu/disable, P0/P1/P2, прямой send, dialogue reset/reload, full memory reset и dispose отменяют pending event/speech и инвалидируют generation. Resume не воспроизводит пропущенные реплики. Game reply после terminal допустим только в этом post-game окне, не после cancel/нового события; social reply после terminal никогда не принимается.

Завершение SocialBid без pet или принятого user chat не вводит паузу в AI event calls. Локальные правила SocialBid/игр сохраняются; friendship/love не уменьшаются из-за отсутствия ответа. Нельзя посылать упрёки или требовать ответ.

## 4. Речь, связь со следующим диалогом и память

`BrainStateDTO.initiativeSpeech` — additive optional projection: absent/null = нет фразы; при #59 publisher выдаёт explicit null/object. Text plain1–240 UTF-16 units, id nonempty≤128, finite nonnegative timestamps, expiresAt>startedAt. Main устанавливает lifetime≤2000ms; game speech заканчивается не позже T+8000ms, social — при первом terminal или обычном expiry. Existing scheduler публикует null; late timer не очищает другой id. Renderer дедуплицирует streamId+id, не ждёт/не сообщает playback completion.

Priority речи: текущий user dialogue и его5s speech guard → existing immediate cursor-game speech → AI initiative. Инициатива не заменяет `dialogue.turn`, draft/receipt/completed reply и не создаёт talking Activity/animation commands. Если верхний слой речи занят, event line пропускается, не откладывается. На expiry не переигрывать предыдущий dialogue bubble. Schema validator/publisher/Renderer подключаются атомарно, без нового окна/графики.

После принятой Main speech publication сохранить один `previousInitiative` в RAM на60s monotonic time и current generation; отдельный wall-clock createdAt нужен только для контекста. Содержит kind/text/time, не provider payload. Это факт публикации для отображения, не доказательство прочтения пользователем. Первый **accepted** user send атомарно захватывает его в свой request **до** invalidation/cancel event owner и очищает слот; rejected/busy send не потребляет. Reset/reload/full reset/dispose, другая generation или expiry очищают. Новый опубликованный AI event заменяет предыдущий. Нет отдельной persist/LLM call ради этого контекста.

Для интерпретации «да/почему?» существует `/v1/chat` с optional previousInitiative. Не подделывать user turn и не вставлять непарную assistant реплику в v1 alternating messages. Остальная v1 chat semantics — [v1](BACKEND_MEMORY_CONTRACT.md): явные факты извлекаются только из текущей user-реплики, не из AI line. При неуспешном accepted turn слот уже потреблён; automatic resend отсутствует.

Durable общая история — исходный GameEpisode и обычные завершённые user/assistant пары. Событийная AI-фраза не записывается непарным message, не создаёт session/fact/summary и не повторяет game feedback/learning. Social event без ответа не сохраняется как вымышленный разговор. После restart старые events не отправляются снова, но реальная игра остаётся доступной recall. Новой SQLite migration или server user-memory storage нет.

## 5. Явный wire v1 и данные

`POST /v1/events`: version1/requestId/event/stream:false/locale/character/memory, **без messages**. Character projection и memory shape/budget полностью соответствуют [v1 §2](BACKEND_MEMORY_CONTRACT.md#2-разрешённая-memory-projection). Event содержит только тип и occurredAtUTC; game также outcome/executedMsfinite0..60000. Local app/run/generation IDs, геометрия, pointer samples, история ignore и OS/activity telemetry не передаются. UUIDv4 requestId назначается один раз logical event и не переиспользуется для другого body.

Успех events: только version1/requestId/text1–240; decision/memoryCandidates/прочие root keys запрещены, а не превращаются в action. Backend делает один LLM call с event-specific server prompt и output cap1024; model/provider выбирает сервер, тот же активный профиль, что у chat (Groq по умолчанию). Current outcome — authoritative context; запрет менять/домысливать физику, утверждать наблюдение экрана, вину/долг ответа или durable writes. Текст model output валидируется независимо от envelope; usage учитывается и при его ошибке.

`POST /v1/chat`: version1 и прежний v1 request плюс optional previousInitiative: kind=cursor_game/social_bid, text1–240, createdAt календарно валидныйUTC. Server не делает предположений об actual user attention по этой записи. Текущий user вопрос и bounded переданный контекст важнее старой AI-фразы; не трактовать её как новое instruction/source фактов. Успех chat — v1 response shape (включая optional memoryCandidates), но version1. Chat сохраняет прежние server10s/body2s/desktop12s/runtime15s deadlines.

Общие caps request32KiB/response16KiB, UTF-16, exact JSON/type/enum validation, HTTPS/loopback, errors/HTTP mapping прежние. Wrong version на любом `/v1/*` →400 unsupported_version с envelope1; requestId null только нераспознанный. Mixed endpoint/version при том же ID →409 conflict; ledger namespace включает method+path+body, все endpoints используют общий учёт usage. Локальных квот backend нет. Неизвестные поля отвергаются; автоматического downgrade нет.

Access/provider data policy, RAM terminal response cache≤10min, ledger IDs≤24h и aggregates≤30d, logs≤7d — [backend §5–6](BACKEND_API_CONTRACT.md#6-данные-сроки-хранения-и-удаление). Допустимый состав v1 расширен только event projection/previousInitiative. Source of truth локальный; backend/provider получает ограниченный контекст, не отдельную личность. Full local reset не отзывает уже переданное и не удаляет provider metadata немедленно; generation защищает desktop от поздней записи/речи. Live endpoint/provider data policy/private ingress — операторское условие, не блокировка code gate.

## 6. Learned preference влияет на локальный выбор (#59)

#57 формирует и сохраняет `activity.cursor_game`; #59 обязательно подключает его к локальному **game-eligible** cursor opportunity. После существующих eligibility/freshness/dwell checks `noticeChance = clamp(baseChance + 0.20*(value/100)*confidence,0,1)` только при confidence≥0.5; иначе baseChance. Используется тот же RNG draw существующего notice resolver, без дополнительного sampling/таймера. Вход — validated Character preference projection, не user fact и не числовой output LLM. Target поля объявлены в `CharacterAutonomySnapshot.learnedCursorGamePreference` и `CursorObserveInput.gameCandidateEligible/learnedGamePreference`; отсутствие/невалидный preference даёт baseline, eligibility не вычисляется из affinity.

При отсутствии mature допустимого game candidate passive gaze/gesture сохраняют прежнюю chance; ручной play, new-acquaintance eligibility, sleep/quiet/P0–P2, общие cooldown/budget, bounded chase и физический outcome не меняются. Высокая affinity не компенсирует запрет gate. Это ограниченный bias вероятности игрового действия, не новый physics/Activity mechanism и не гарантия игры на каждый cursor sample.

Обязательная приёмка #59: при одинаковых environment/needs/RNG положительная и отрицательная learned affinity дают различный допустимый игровой выбор на выбранной границе; after restart результат сохраняется; confidence<0.5/отсутствие preference воспроизводит baseline; quiet/sleep/stale/dwell/budget всё ещё блокируют. #57 не считается доказательством влияния на поведение до этой интеграции.

## 7. Fixtures и проверка

Общие [v1 fixtures](fixtures/desktop-backend-v1/events): оба event requests, event success/error и follow-up chat request/success. Success/error — альтернативы HTTP200/503.

Desktop: duplicate commit/no-op, uncertain/failed game write, cancelled game, current SocialBid terminal, exact deadline, quiet/ignore/pet reset, отсутствие квот/startup delay/пауз после ошибок, user preemption/abort settlement без overlap, speech priority/expiry, previousInitiative60s/currentgeneration, reset/dispose после каждого await, отсутствие дополнительного reward/extraction/write/automatic calls, restored preference bias. Backend: route/version/schema/bounds/previousInitiative, event text-only, fixtures, shared endpoint accounting/ID conflict, deadline/cancel/usage-on-error, no payload logs. Typecheck→npm test для developer; pip check+pytest для backend. Windows smoke пользователь выполняет вручную; архитектор runtime tests/build не запускает.

## 8. Явное касание v1

Обычный клик сохраняет локальный базовый эффект и визуальную реакцию, затем
допускает один `POST /v1/touch` с factual `user_touch/variant:touch` и appraisal.
Полные DTO, локальные эффекты, fallback и trace определены в §10.

Касание доступно при настроенном backend независимо от флага автономных AI-событий и автопрогулок. Касания не имеют локальных квот или задержек между запросами. Один shared transport, без retries/очереди: повторные клики во время touch request пропускаются. Занятый прежним запросом слот не создаёт отложенное касание. Quiet/menu/sleep/critical needs/forced motion и thinking блокируют отправку; текстовый чат отменяет касание и ждёт settlement перед своим запросом.

Reset/dispose/перетаскивание инвалидируют результат. Обычная автономная смена
занятия не отменяет касание при сохранении gates. Touch не создаёт previousInitiative;
его краткий след previousTouch имеет отдельные правила §10.

## 9. Observation boundary

[OBS-A02 #84](https://github.com/zyzycode/project_wisp/issues/84) реализован в #81:
[Perception §11](../../frontend/docs/engine/PERCEPTION_ENGINE.md#11-obs-a02-активное-приложение-и-заголовок)
разрешает только explicit consent + allowlisted foreground metadata. Отдельный
`POST /v1/observation`, **не** новый variant `/v1/events` и не chat. Chat/touch/events/summary имеют отдельные schemas; observation не подмешивается в messages,
memory, character, summary или previousInitiative. Включение observer не меняет
eventsEnabled/summary configuration; observation доступен независимо от этих флагов.
Main создаёт v1 adapter только при настроенном backend; mock/direct-only mode даёт
unavailable без сетевого/fixed-speech fallback. Consent обязателен и в backend mode.

### 9.1. Exact wire и compatibility

Request — exact object `version:1`, UUIDv4 `requestId`, `stream:false`, `locale:ru|en`,
`character` по [v1 §2](BACKEND_API_CONTRACT.md#2-поля-и-валидация), `observation`.
Observation — exact `{appName, windowTitle}`: обе строки обязательны; appName trimmed
1–80, windowTitle trimmed 0–160 UTF-16 units. Empty caption — empty string, не null.
C0/C1, bidi controls U+061C/U+200E/F/U+202A–E/U+2066–9 и lone surrogates запрещены.
AppName source/normalization — Perception §11.1; schema не превращает их в доверенные
данные. Нет event/occurredAt/messages/memory/lore/summary, appKey/category/local IDs,
executable paths/native handles/PID, usage history, pixels/OCR/clipboard/documents.

HTTP200 success — exact `version:1, requestId, text`: trimmed plain 1–240 UTF-16 units
по общим text rules v1. Никаких decision/memoryCandidates/tools/actions/deltas;
**любые** лишние model/response keys делают весь результат invalid, без chat sanitization.
Model даёт только `{text}`; backend сам добавляет version/ID. Ошибка — прежняя exact
error shape v1 с envelope1; таблица HTTP/code [v1 §3](BACKEND_API_CONTRACT.md#3-http-и-ошибки).
Wrong version на этом path →400 unsupported_version/envelope1; ID null только если
не распознан. UTF-8 JSON request≤32KiB/response≤16KiB, strict types/no coercion,
unknown fields rejected до admission; body overflow→413, malformed→400.

HTTPS/loopback и closed private access без application auth — [v1 §5](BACKEND_API_CONTRACT.md#5-закрытая-alpha-серверный-admission-учёт-и-повторы).
401/403 gateway означают нет доступа, не success/повод обхода или автоматического
login/retry. 404/unsupported/malformed/timeout/offline → нет observation речи.
Никаких probe/downgrade/failover/automatic retries. UUID назначается на одну попытку;
общий ledger digest включает method/path/body: identical pending→409 in_progress,
terminal replay≤10min без нового inference; changed/cross-endpoint/expired replay→409
conflict. Это существующий ledger, без новых tables, user storage/auth/quota topology.

### 9.2. Admission, interlock и цена

30s dwell/one attempt per episode/10min guard/InitiativeBudget принадлежат
Perception §11.3. Частота — максимум шесть попыток за любой полуоткрытый час app run
при непрерывной работе; каждый transport start расходует попытку даже при cancel/error.
Один generation inference с output cap `min(server setting,1024)`; provider input budget
16384 минус output reserve. Gemini использует bounded countTokens preflight, Groq —
консервативную UTF-8/framing оценку по [общему бюджету](../../backend/docs/CONTEXT_PROMPT_ENGINE.md#бюджет-и-ошибка).
Count и generation делят прежний deadline; count failure/overflow не запускает generation. Это bounded cost, не обещание
денежной цены/серверной квоты. Provider и current character profile прежние.

Все chat/touch/events/explicit summary/observation используют **один** desktop
transport/interlock. Observation стартует только при свободном slot/gates, не отменяет
другую работу и не ожидает её в очереди. Принятый user chat/touch/explicit summary
отменяет pending observation и его speech, ждёт settlement старого HTTP promise перед
новым fetch; это не два concurrent requests. Event при уже занятом observation slot
пропускается по обычным event rules; опубликованная higher-priority speech снимает
observation. Observation не блокирует canSubmit. После await ещё раз проверить
собственный current request/generation/deadline. Abort settlement≤3000ms; пользовательский
15s deadline включает ожидание. Summary interlock из [Context §4](CONTEXT_DATA_CONTRACT.md#4-бюджет-ошибки-cancellation-и-retention)
сохраняется в обе стороны, отдельный параллельный HTTP client запрещён.

Runtime≤3500ms от admission, desktop transport≤3000ms, server≤2500ms включая body≤500ms;
ровно на deadline результат поздний. Request сборка и проверки входят в runtime.
До dispatch/после каждого await/до speech проверяется current source согласно
Perception §11.2, не timestamp исходного payload и не boolean от Renderer.
Source/policy change, stale, pause/revoke/lock/suspend/reset/reload/dispose и user
preemption abort-ят request и инвалидируют publication; resume не возвращает очередь.
Disconnect/shutdown закрывают provider stream/task; late usage settles once без речи.
Остановка remote inference/charge при abort физически не гарантирована.

### 9.3. Prompt, данные и fixtures

Backend использует [отдельный observation scenario](../../backend/docs/CONTEXT_PROMPT_ENGINE.md#obs-a02-untrusted-observation)
с character/current state и untrusted appName/windowTitle, без memory extraction,
lore/recall/history/summary. Ни caption, ни reply не user fact или authority о занятии.
Local FSM/Motion/input независимы; нет фиксированной fallback фразы.

Desktop RAM/policy — Perception §11.4. Backend request/context RAM только до terminal;
не хранить observation/profile/history durable и не логировать payload/AI text/APM.
Terminal response RAM cache≤10min/eviction/restart может содержать производную от title
реплику. Existing ledger хранит только ID/path/body digest/accounting≤24h, aggregates≤30d,
metadata logs≤7d по [v1 §6](BACKEND_API_CONTRACT.md#6-данные-сроки-хранения-и-удаление), без app fields/usage history.
Provider получает только согласованный context по действующему provider-specific режиму:
Groq ZDR verification до внешних тестеров; Gemini synthetic-only, пока rollout gate
не выполнен. Local revoke/delete не удаляет replay/provider copy и не обещает немедленный
remote erasure; server-delete endpoint отсутствует. No real capture/provider call в #81.

Общий [corpus v1](fixtures/desktop-backend-v1/observation/) содержит `request.valid.json`,
`request.empty-title.json`, `request.hostile-title.json`, `response.success.json`,
`response.error.json` (альтернатива HTTP503), `invalid.json` с named invalid requests/
responses (wrong version, missing/extra keys, strict types, UTF-16/control/bidi/surrogate,
byte caps и forbidden response candidates). Обе стороны читают один corpus, старые
fixtures неизменны. Desktop и backend валидируют этот corpus в тестах #81.
Acceptance: boundary reject до provider, hostile strings только data, strict text-only,
один call/accounting/replay/mixed-ID conflict, 401/403/404/502/503/504/malformed/timeout,
cancel/late usage, source freshness/preemption/no overlap/no retry, restart без consent,
non-Windows unsupported; Groq/Gemini handlers только mock transport. Windows smoke
отдельно: consent/allowlist/title switch/pause/revoke/helper shutdown/offline.

## 10. INTERACTION-A01: семантическое взаимодействие v1

Актуальные `POST /v1/touch` и `POST /v1/chat` всегда включают appraisal.
Main включает interaction capability для настроенного внешнего адаптера.
Автономные events остаются opt-in через `WISP_AI_EVENTS_ENABLED`, summary — через
`WISP_SUMMARY_ENABLED`; обе возможности используют тот же клиент и `/v1`.
Никаких version probing, upgrade/downgrade или второго inference при ошибке.

### 10.1. Точные DTO и validation

Единственная TypeScript wire форма — [backend-interaction-contract.ts](../../frontend/src/application/ports/backend-interaction-contract.ts).
Независимые Python schemas реализует #89; нельзя импортировать TS/Domain types.
v1 touch request — exact version/requestId/stream/locale/character/event/card/effectPolicy.
Character и UUIDv4/locale/stream:false как v1; event строго user_touch/variant:touch.
Card exact id=shyDreamGirl/revision=1; id обязан совпадать с character.personality.presetId.
Неизвестная revision/card →400 invalid_request до inference, не молчаливый другой profile.
EffectPolicy eligible/suppressed — решение desktop о доступности numerical effect,
не server authority. Никаких времени касания/координат/истории/memory/local IDs в touch.

Chat включает messages/memory, optional summary/previousInitiative, обязательные card/effectPolicy и optional
previousTouch. Все старые v1 caps и validation memory/messages/summary/previousInitiative
сохраняются; memory required (пустая допустима). PreviousTouch exact shape по wire type:
action=touch, календарно валидный UTC occurredAt, publishedText trimmed plain 1–240 UTF-16,
закрытый appraisal, effect/reason/bands. Допустимые пары effect/reason:
accepted/applied; neutral/neutral или uncertain; suppressed/cooldown;
rejected/state_changed или unavailable. energyBand tired/rested и comfortBand
calm/overloaded описывают локальный pre-base snapshot, не текущее состояние.
Local requestId/generation/monotonic time, numeric deltas и полная история touch запрещены.

Touch success exact version1/requestId/text/appraisal, text 1–240 UTF-16.
Chat success содержит version1/requestId/text, optional decision/memoryCandidates и обязательный appraisal; text 1–2000 UTF-16;
decision/memoryCandidates остаются прежними optional полями. Appraisal exact
category supportive/playful/boundary/hostile/neutral, intensity low/moderate,
confidence clear/uncertain. Нет numeric scores/deltas/evidence/user fact fields.
Неверный/пропущенный appraisal, unknown root/nested key, wrong enum/type, invalid text
делают **весь** response invalid_model_response, без частичного принятия текста.
Touch hostile/moderate недопустимы, отклоняются backend и desktop. Chat decision
sanitization и memoryCandidates source validation сохраняются независимо от appraisal.
Model выдаёт response content без envelope; version/ID добавляет только backend.

Сервер принимает effectPolicy=suppressed как запрет обещать изменение: model appraisal
должен быть neutral/low/clear; неверный proposal отклоняет весь model result.
Desktop повторно проверяет policy/current gate, не доверяет server enforcement.
При eligible model может выбрать neutral/uncertain; это корректный ответ без эффекта.
Response не содержит новой auth, consent, tool calls или commands. Error envelope exact
version1/requestId/error по v1 HTTP/code mapping; wrong version →400 unsupported_version,
нераспознанный UUID →requestId null. UTF-8 JSON request≤32KiB/response≤16KiB;
strict types/no coercion, unknown fields reject, UTF-16/control/surrogate rules v1.

### 10.2. Lifecycle, стоимость и данные

Shared transport/interlock chat/touch/events/summary/observation остаётся единственным.
Touch требует прежних input/quiet/menu/sleep/critical/forced-motion gates §8; busy touch
пропускается без отложенной очереди. User chat отменяет touch и ждёт settlement;
user touch/chat preempt observation по §9.2. Никаких дополнительных запросов для
classification, reconciliation, extraction или объяснения: **один** inference на
принятое обращение, output cap touch≤1024/chat≤4096, прежний общий budget16384.
Gemini countTokens — bounded preflight полного payload до generation в том же deadline,
не отдельная classification/extraction; Groq сохраняет локальную оценку.
Вопрос «почему?» — обычный новый user chat, не автоматический follow-up.

Runtime15s включает interlock wait и сборку; transport12s; server10s включая body2s.
now≥deadline поздно. Abort settlement≤3000ms, generation/deadline/source проверяются
после каждого await и перед effect/text/trace. Reset/dispose/drag invalidates touch;
chat сохраняет прежний drag lifecycle. Cancel не гарантирует остановку remote charge.
Ошибка/timeout/отсутствие backend не отменяют фактический input/base; локальная реплика,
rejected proposal и отсутствие второго reward — [Character §9.1](../../frontend/docs/engine/CHARACTER_ENGINE.md#91-interaction-a01-общая-карточка-и-локальная-оценка-87).

HTTPS/loopback/private ingress и отсутствие application auth — v1 §5. Gateway401/403 —
ошибка доступа, без login обхода/retry; 404/unsupported означает недоступную возможность.
UUID один на logical attempt; existing ledger method/path/body digest:
pending identical→409 in_progress, identical terminal replay≤10min без inference,
changed body/cross-version/path или expired replay→409 conflict. Desktop не делает
автоповторы; duplicate callbacks/replay не применяют effect повторно.

Local source of truth и traceTTL/reset — [Memory §13](../../frontend/docs/engine/MEMORY_ENGINE.md#13-interaction-a01-краткий-след-касания-87).
Backend request/context только RAM до terminal; terminal response cache≤10min может
содержать text/appraisal. Ledger metadata/digest≤24h, aggregates≤30d, logs metadata≤7d,
без payload/prompts/user text/state/appraisal. Server conversation storage отсутствует.
Provider получает только bounded scenario context под действующим provider policy;
Groq ZDR / Gemini synthetic-only rollout gate прежний. Local delete/reset убирает
след из последующего контекста, но не обещает remote erasure уже переданного/cache;
новый server-delete endpoint не вводится.

### 10.3. Общий corpus

Обе стороны проверяют единый corpus `docs/contracts/fixtures/desktop-backend-v1/interaction/`:
chat/touch requests, responses, ошибки, invalid cases и eligible chat cases.
EffectPolicy определяется текущим Character gate; suppressed требует neutral/low/clear,
eligible допускает разрешённый appraisal. Обе формы используют один маршрут и версию.

Обязательные cases: actual touch не random gesture; happy/tired/overloaded; unchanged
bands vs crossed bands during await; clear/uncertain/neutral; partial clamp; shared
10s base/30s appraisal limits; duplicate callbacks/replay и exactly one chat reward;
no backend/401/403/404/malformed/timeout; current consent; reset/dispose/delete/TTL/late;
shared preemption без HTTP overlap; restart сохраняет state, но не touch cause;
follow-up видит published text и accepted/rejected cause, никогда invented user intent;
обе модели через mock transports, без live/provider calls.
