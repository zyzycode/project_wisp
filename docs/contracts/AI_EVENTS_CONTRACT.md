# P17-A04: игровые события и AI-инициативы

Canonical contract для [#58](https://github.com/zyzycode/project_wisp/issues/58); реализация — #59 и отдельная server v1 задача. Локальные механики [cursor-game](../../frontend/docs/engine/ACTIVITY_ENGINE.md#17-cursor-game-v1) и [SocialBid](../../frontend/docs/engine/AUTONOMY_ENGINE.md#13-auto-a09-локальная-жизнь-и-ненавязчивость) не ждут сеть и сохраняют владельцев/пределы. Эта функция добавляет короткую речь и ограниченное использование уже выученного предпочтения, без новых сенсоров/игр/графики.


## 1. Минимальный scope автономных событий и владение

| Допустимое автономное событие | Источник и цель |
|---|---|
| `cursor_game_completed` | Реальный completed terminal текущего run, playCompleted=true, outcome caught/missed/lost_target; тот же GameEpisode уже подтверждён SQLite. Одна необязательная короткая реплика об этом исходе/общей истории |
| `social_bid_started` | Уже начавшийся локальный SocialBid после его обычного Character gate и расходования existing InitiativeBudget. Одна необязательная контекстная фраза в дополнение к жесту |
| Target #131 `window_help_requested` | Actual resolved Domain Explore decision needs_manual_support, verified current window target; исключение без Activity start по §11, не preview/admission от caller |

Cancelled/failed run, admission без start, gaze, samples/retarget/physics/Needs ticks, sleep/wake/idle/return/startup сами модель не вызывают; target #131 единственное отдельное исключение — actual Domain-selected verified manual-help goal по §11, не fake Activity. Pulse лишь исполняет существующие causal deadlines, не ищет повод к LLM. Game/social source run даёт≤1 request каждого разрешённого типа; help имеет один attempt на свой decision source.

Результат событийного provider — **только text**. Нет decision, memoryCandidates, числовых deltas, tools или нового provider-owned Activity. Физический исход остаётся desktop fact; сервер получает его, а не предлагает заменить. Character/Activity/память не меняются от публикации AI-фразы, `provider_response` stimulus не создаётся. Нельзя выдавать caught за доказанное удовольствие/социальное участие пользователя.

Application владеет event lifecycle/current IDs/generation и admission; Domain — gates, локальная вероятность выбора и невмешательство в P0–P2; Infrastructure/Main — транспорт/abort/DI. Типы: [semantic events](../../frontend/src/application/ports/ai-event-provider.interface.ts), [wire v1](../../frontend/src/application/ports/backend-events-contract.ts), [IPC speech](../../frontend/src/shared/ipc-contracts.ts). Нового IPC command или callback от Renderer для модели нет.

## 2. Транспорт и приоритет пользователя

Все v1 обращения одного Main используют общий транспорт, максимум один текущий запрос. Локальных minute/hour/session квот, резерва для диалога, startup delay и минимального интервала между AI-событиями нет.

Учёт использования backend описан в [§5](BACKEND_API_CONTRACT.md#5-закрытая-alpha-серверный-admission-учёт-и-повторы) и не блокирует запросы по квотам. Настройки провайдера не передаются в Renderer.

Сеть автономных событий default false. Target #131 заменяет production consent из env на явный RAM session opt-in по §11: наличие adapter/key не consent; launcher не переключается в true. До совместной реализации действует прежний eventsEnabled config. Версия API не выбирается. Нет event polling/retries/запроса на local fallback/«проверить бюджет»/failover. Один pending event timer/request/speech owner, без очереди; competing event пропускается.

Эти условия относятся к автономным game/social событиям. Явное касание пользователя имеет отдельный v1 путь и admission из §8.

Прямой user chat важнее event: admission пользовательского turn сохраняет действующий receipt/15s deadline, отменяет pending event/его speech и abort-ит event transport. До generateResponse runtime ожидает `IAIEventInterlock.interruptForUser()` — settlement **старого HTTP promise**, без второго параллельного fetch. Это один уже принятый user turn, не очередь инициатив. Event adapter обязан settle после abort и во всех случаях не позже собственного3s timeout; поздний результат уже invalid. Если user turn к settlement retired/reset/expired, generateResponse не вызывается. Input/drag/Brain ticks ожидание не блокирует. `canSubmit` не становится false только из-за автономного event. Локальных rate/session/cooldown блокировок нет.

## 3. Causal deadlines, quiet и игнорирование

### Игра

Дедуп-ключ — `(appRunId, activityRunId, memoryGeneration)`, связанный с actual Activity terminal. `IGameEpisodeCommitObserver` вызывается после append acknowledgement; успешный idempotent no-op может повторить callback, поэтому observer независимо дедуплицирует. `GameEpisode.outcome` недостаточен для доказательства completed run: сверить `ActivityOutcomeFeedback.outcome=completed` и тот же run. Cancel после play phase может сохраниться в БД, но не запускает event.

Время T — реальный terminal monotonic time. Подтверждение записи должно прийти до T+2000ms; на T+2000ms планируется **одна** causal попытка, после существующей локальной outcome speech. При callback now≥T+2500ms, отсутствии ack, новом user interaction/game/SocialBid или потере gates — пропуск без позднего catch-up. Старую speech не задерживать/не заменять и terminal не продлевать. Это новый короткий комментарий после непосредственной реакции, не повтор physical outcome effect.

### SocialBid

Триггер сразу после реального started и existing budget.start; request не выбирает/не задерживает жест или его4s wait. Reply разрешён только пока тот же SocialBid ещё active и исходные gates действуют; completed/cancelled/failed до reply → discard. Deadline Activity не продлевается ради AI. Переход к обычному локальному следующему занятию не откладывается.

Вторая невербальная попытка [SOC-A01](../../frontend/docs/engine/AUTONOMY_ENGINE.md#132-одна-дополнительная-попытка-после-молчания-soc-a01) — implementation target отдельной задачи, не новый `social_bid_started` AI-trigger. Для second Main не вызывает `onSocialBidStarted`/`socialStarted`; нет recall, transport, speech publication, `previousInitiative`, истории или memory write. System/P3 return сохраняет своё исключение, first — прежний opt-in event path. Следующий user chat с `previousInitiative` (§4) остаётся ответом на реально опубликованную первую AI-фразу, а не автоматической второй инициативой.

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

`POST /v1/events`: requestId/event/stream:false/locale/character/memory, **без messages**. Character projection и memory shape/budget полностью соответствуют [v1 §2](BACKEND_MEMORY_CONTRACT.md#2-разрешённая-memory-projection), включая bounded causal_event по [§11](BACKEND_MEMORY_CONTRACT.md#11-memory-a01-проекция-собственного-события-171) после совместного rollout #172. Это общий selected-memory shape, не новый event/trigger или право повторно применить experience/reward. Event содержит type/occurredAtUTC; game также outcome/executedMsfinite0..60000; target #131 window_help_requested добавляет только targetRegion по §11. Local app/run/generation IDs, геометрия, pointer samples, история ignore и OS/activity telemetry не передаются. UUIDv4 requestId назначается один раз logical event и не переиспользуется для другого body.

Успех events: только requestId/text1–240; decision/memoryCandidates/прочие root keys запрещены, а не превращаются в action. Backend делает один LLM call с event-specific server prompt и output cap1024; model/provider выбирает сервер, тот же активный профиль, что у chat (OpenAI по умолчанию). Current outcome — authoritative context; запрет менять/домысливать физику, утверждать наблюдение экрана, вину/долг ответа или durable writes. Текст model output валидируется независимо от envelope; usage учитывается и при его ошибке.

`POST /v1/chat`: optional previousInitiative kind=cursor_game/social_bid, text1–240, createdAt calendarUTC; target #131 window_help добавляет authoritative outcome по §11/[Backend Memory§16](BACKEND_MEMORY_CONTRACT.md#16-qa-soc-01-previous-window-help-initiative-131). Server не выводит actual user attention/intent из записи. Current user/контекст сильнее старой AI-фразы, не нового instruction/source фактов. Успех chat — прежний v1 response с optional memoryCandidates; server10s/body2s/desktop12s/runtime15s прежние.

Общие caps request32KiB/response16KiB, UTF-16, exact JSON/type/enum validation, HTTPS/loopback, errors/HTTP mapping прежние. requestId null только нераспознанный. Mixed endpoint/body при том же ID →409 conflict; ledger namespace включает method+path+body, все endpoints используют общий учёт usage. Локальных квот backend нет. Неизвестные поля отвергаются; автоматического downgrade нет.

Access/provider data policy, RAM terminal response cache≤10min, ledger IDs≤24h и aggregates≤30d, logs≤7d — [backend §5–6](BACKEND_API_CONTRACT.md#6-данные-сроки-хранения-и-удаление). Допустимый состав v1 расширен только event projection/previousInitiative. Source of truth локальный; backend/provider получает ограниченный контекст, не отдельную личность. Full local reset не отзывает уже переданное и не удаляет provider metadata немедленно; generation защищает desktop от поздней записи/речи. Live endpoint/provider data policy/private ingress — операторское условие, не блокировка code gate.

## 6. Learned preference влияет на локальный выбор (#59)

#57 формирует и сохраняет `activity.cursor_game`; #59 обязательно подключает его к локальному **game-eligible** cursor opportunity. После существующих eligibility/freshness/dwell checks `noticeChance = clamp(baseChance + 0.20*(value/100)*confidence,0,1)` только при confidence≥0.5; иначе baseChance. Используется тот же RNG draw существующего notice resolver, без дополнительного sampling/таймера. Вход — validated Character preference projection, не user fact и не числовой output LLM. Target поля объявлены в `CharacterAutonomySnapshot.learnedCursorGamePreference` и `CursorObserveInput.gameCandidateEligible/learnedGamePreference`; отсутствие/невалидный preference даёт baseline, eligibility не вычисляется из affinity.

При отсутствии mature допустимого game candidate passive gaze/gesture сохраняют прежнюю chance; ручной play, new-acquaintance eligibility, sleep/quiet/P0–P2, общие cooldown/budget, bounded chase и физический outcome не меняются. Высокая affinity не компенсирует запрет gate. Это ограниченный bias вероятности игрового действия, не новый physics/Activity mechanism и не гарантия игры на каждый cursor sample.

Обязательная приёмка #59: при одинаковых environment/needs/RNG положительная и отрицательная learned affinity дают различный допустимый игровой выбор на выбранной границе; after restart результат сохраняется; confidence<0.5/отсутствие preference воспроизводит baseline; quiet/sleep/stale/dwell/budget всё ещё блокируют. #57 не считается доказательством влияния на поведение до этой интеграции.

## 7. Fixtures и проверка

Общие [v1 fixtures](fixtures/desktop-backend-v1/events): оба event requests, event success/error и follow-up chat request/success. Success/error — альтернативы HTTP200/503.

Desktop: duplicate commit/no-op, uncertain/failed game write, cancelled game, current SocialBid terminal, exact deadline, quiet/ignore/pet reset, отсутствие квот/startup delay/пауз после ошибок, user preemption/abort settlement без overlap, speech priority/expiry, previousInitiative60s/currentgeneration, reset/dispose после каждого await, отсутствие дополнительного reward/extraction/write/automatic calls, restored preference bias. Backend: route/schema/bounds/previousInitiative, event text-only, fixtures, shared endpoint accounting/ID conflict, deadline/cancel/usage-on-error, no payload logs. Typecheck→npm test для developer; pip check+pytest для backend. Windows smoke пользователь выполняет вручную; архитектор runtime tests/build не запускает.

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

Request — exact object с UUIDv4 `requestId`, `stream:false`, `locale:ru|en`,
`character` по [v1 §2](BACKEND_API_CONTRACT.md#2-поля-и-валидация), `observation`.
Observation — exact `{appName, windowTitle}`: обе строки обязательны; appName trimmed
1–80, windowTitle trimmed 0–160 UTF-16 units. Empty caption — empty string, не null.
C0/C1, bidi controls U+061C/U+200E/F/U+202A–E/U+2066–9 и lone surrogates запрещены.
AppName source/normalization — Perception §11.1; schema не превращает их в доверенные
данные. Нет event/occurredAt/messages/memory/lore/summary, appKey/category/local IDs,
executable paths/native handles/PID, usage history, pixels/OCR/clipboard/documents.

HTTP200 success — exact `requestId, text`: trimmed plain 1–240 UTF-16 units
по общим text rules v1. Никаких decision/memoryCandidates/tools/actions/deltas;
**любые** лишние model/response keys делают весь результат invalid, без chat sanitization.
Model даёт только `{text}`; backend сам добавляет requestId. Ошибка — прежняя exact
error shape; таблица HTTP/code [v1 §3](BACKEND_API_CONTRACT.md#3-http-и-ошибки).
ID null только если
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
16384 минус output reserve. Gemini использует bounded countTokens preflight, OpenAI —
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
lore/recall/history/summary. Отдельных prompt-запретов цитирования caption и выводов
о предпочтениях/занятии пользователя нет; observation по-прежнему возвращает только text.
Local FSM/Motion/input независимы; нет фиксированной fallback фразы.

Desktop RAM/policy — Perception §11.4. Backend request/context RAM только до terminal;
не хранить observation/profile/history durable и не логировать payload/AI text/APM.
Terminal response RAM cache≤10min/eviction/restart может содержать производную от title
реплику. Existing ledger хранит только ID/path/body digest/accounting≤24h, aggregates≤30d,
metadata logs≤7d по [v1 §6](BACKEND_API_CONTRACT.md#6-данные-сроки-хранения-и-удаление), без app fields/usage history.
Provider получает только согласованный context по действующему provider-specific режиму:
OpenAI — условия допуска внешних тестеров из v1 §6; Gemini synthetic-only, пока rollout gate
не выполнен. Local revoke/delete не удаляет replay/provider copy и не обещает немедленный
remote erasure; server-delete endpoint отсутствует. No real capture/provider call в #81.

Общий [corpus v1](fixtures/desktop-backend-v1/observation/) содержит `request.valid.json`,
`request.empty-title.json`, `request.hostile-title.json`, `response.success.json`,
`response.error.json` (альтернатива HTTP503), `invalid.json` с named invalid requests/
responses (missing/extra keys, strict types, UTF-16/control/bidi/surrogate,
byte caps и forbidden response candidates). Обе стороны читают один corpus, старые
fixtures неизменны. Desktop и backend валидируют этот corpus в тестах #81.
Acceptance: boundary reject до provider, hostile strings только data, strict text-only,
один call/accounting/replay/mixed-ID conflict, 401/403/404/502/503/504/malformed/timeout,
cancel/late usage, source freshness/preemption/no overlap/no retry, restart без consent,
non-Windows unsupported; OpenAI/Gemini handlers только mock transport. Windows smoke
отдельно: consent/allowlist/title switch/pause/revoke/helper shutdown/offline.

## 10. INTERACTION-A01: семантическое взаимодействие v1

Актуальные `POST /v1/touch` и `POST /v1/chat` всегда включают appraisal.
Main включает interaction capability для настроенного внешнего адаптера.
Автономные events требуют отдельного opt-in (target #131 session controls §11), summary — через
`WISP_SUMMARY_ENABLED`; обе возможности используют тот же клиент и `/v1`.
Никаких version probing, upgrade/downgrade или второго inference при ошибке.

### 10.1. Точные DTO и validation

Единственная TypeScript wire форма — [backend-interaction-contract.ts](../../frontend/src/application/ports/backend-interaction-contract.ts).
Независимые Python schemas реализует #89; нельзя импортировать TS/Domain types.
v1 touch request — exact requestId/stream/locale/character/event/card/effectPolicy.
Character и UUIDv4/locale/stream:false как v1; optional character.expression.causal вводится только совместным #161 rollout по [API §2.2](BACKEND_API_CONTRACT.md#22-ce-a01-причинная-проекция); causal touch всегда effectPolicy=suppressed, model appraisal neutral/low/clear; event строго user_touch/variant:touch.
Card exact id=curiousStubbornGirl/revision=3 в поставке #137 по решению #140;
id обязан совпадать с character.personality.presetId. Предыдущая поставка #123 — revision2,
не совместимый runtime-вариант: content/reference/mappers/chat/touch/shared fixtures
обновляются совместно, без old+new adapter. Card revision не wire version.
Источник и восстановление — [Character §6/9.2](../../frontend/docs/engine/CHARACTER_ENGINE.md#6-авторский-профиль-wisp-revision-2-gate-122), [Memory §4](../../frontend/docs/engine/MEMORY_ENGINE.md#restore-snapshot).
Неизвестная revision/card →400 invalid_request до inference, не молчаливый другой profile.
EffectPolicy eligible/suppressed — решение desktop о доступности numerical effect,
не server authority. Никаких времени касания/координат/истории/memory/local IDs в touch; causal enums не разрешают передавать raw episodes или локальные sequence.

Chat включает messages/memory, optional summary/previousInitiative, обязательные card/effectPolicy и optional
previousTouch. Все старые v1 caps и validation memory/messages/summary/previousInitiative
сохраняются; memory required (пустая допустима). PreviousTouch exact shape по wire type:
action=touch, календарно валидный UTC occurredAt, publishedText trimmed plain 1–240 UTF-16,
закрытый appraisal, effect/reason/bands. Допустимые пары effect/reason:
accepted/applied; neutral/neutral или uncertain; suppressed/cooldown;
rejected/state_changed или unavailable. energyBand tired/rested и comfortBand
calm/overloaded описывают локальный pre-base snapshot, не текущее состояние.
Local requestId/generation/monotonic time, numeric deltas и полная история touch запрещены.

Touch success exact requestId/text/appraisal, text 1–240 UTF-16.
Chat success содержит requestId/text, optional decision/memoryCandidates и обязательный appraisal; text 1–2000 UTF-16;
decision/memoryCandidates остаются прежними optional полями. Appraisal exact
category supportive/playful/boundary/hostile/neutral, intensity low/moderate,
confidence clear/uncertain. Нет numeric scores/deltas/evidence/user fact fields.
Неверный/пропущенный appraisal, unknown root/nested key, wrong enum/type, invalid text
делают **весь** response invalid_model_response, без частичного принятия текста.
Touch hostile/moderate недопустимы, отклоняются backend и desktop. Chat decision
sanitization и memoryCandidates source validation сохраняются независимо от appraisal.
Model выдаёт response content без envelope; requestId добавляет только backend.

Сервер принимает effectPolicy=suppressed как запрет обещать изменение: model appraisal
должен быть neutral/low/clear; неверный proposal отклоняет весь model result.
Desktop повторно проверяет policy/current gate, не доверяет server enforcement.
При eligible model может выбрать neutral/uncertain; это корректный ответ без эффекта.
Response не содержит новой auth, consent, tool calls или commands. Error envelope exact
requestId/error по общей таблице HTTP/code;
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
не отдельная classification/extraction; OpenAI сохраняет локальную оценку.
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
changed body/path или expired replay→409 conflict. Desktop не делает
автоповторы; duplicate callbacks/replay не применяют effect повторно.

Local source of truth и traceTTL/reset — [Memory §13](../../frontend/docs/engine/MEMORY_ENGINE.md#13-interaction-a01-краткий-след-касания-87).
Backend request/context только RAM до terminal; terminal response cache≤10min может
содержать text/appraisal. Ledger metadata/digest≤24h, aggregates≤30d, logs metadata≤7d,
без payload/prompts/user text/state/appraisal. Server conversation storage отсутствует.
Provider получает только bounded scenario context под действующим provider policy;
Условия допуска внешних тестеров для OpenAI и Gemini из v1 §6 сохраняются. Local delete/reset убирает
след из последующего контекста, но не обещает remote erasure уже переданного/cache;
новый server-delete endpoint не вводится.

### 10.3. Общий corpus

Обе стороны проверяют единый corpus `docs/contracts/fixtures/desktop-backend-v1/interaction/`:
chat/touch requests, responses, ошибки, invalid cases и eligible chat cases.
EffectPolicy определяется текущим Character gate; suppressed требует neutral/low/clear,
eligible допускает разрешённый appraisal. Обе формы используют один контракт.

Обязательные cases: actual touch не random gesture; happy/tired/overloaded; unchanged
bands vs crossed bands during await; clear/uncertain/neutral; partial clamp; shared
10s base/30s appraisal limits; duplicate callbacks/replay и exactly one chat reward;
no backend/401/403/404/malformed/timeout; current consent; reset/dispose/delete/TTL/late;
shared preemption без HTTP overlap; restart сохраняет state, но не touch cause;
follow-up видит published text и accepted/rejected cause, никогда invented user intent;
обе модели через mock transports, без live/provider calls.

## 11. QA-SOC-01: явная инициатива и просьба о проверенном окне (#131)

Scope: инициативные тексты и manual window help, не голод/еда/кормление: владелец явно отложил food; energy означает бодрость. Это target gate, active IPC/events/chat unions/guards/publisher/Renderer поставляются вместе в реализации #131. [Controls DTO](../../frontend/src/application/ports/initiative-controls.interface.ts), [local help types](../../frontend/src/application/ports/window-help.interface.ts), [wire target](../../frontend/src/application/ports/backend-window-help-contract.ts), независимая [Python schema](../../backend/wisp_backend/api/schemas/window_help.py). Existing SocialBid/local gestures доступны и без LLM, но не называются содержательным разговором.

**Session consent.** Main владеет enabled=false на каждый process/profile session; не SQLite/settings file/env/key и не Renderer mount. Сохранение/подключение ключа не включает инициативу. Factory предоставляет event adapter capability при configured backend отдельно от разрешения; production WISP_AI_EVENTS_ENABLED не подменяет UI consent, launcher/tooling не меняется, summary flag независим. Только явный toggle в существующем AI connection/settings меняет RAM consent после streamId/current-profile validation, без provider probe/проверочного платного вызова. Status содержит Main-owned profileGeneration (nonnegative safe integer); read требует только streamId, setConsent несёт также epoch последнего status, Main атомарно сверяет injected current profile epoch перед enable/revoke. Epoch меняется синхронно до full reset/profile replacement даже при прежнем Brain streamId; old-profile command→stale. Поле не backend/wire context и не доверенная authority от Renderer. Enable не отправляет call и не replay-ит прежний source/gesture: допускаются лишь новые actual natural events после enable. Revoke синхронно снимает pending timer/source/speech/help/previousInitiative и abort transport; старое settlement не публикует результат. Переключение ключа/route/profile/full reset/restart возвращает false; quiet/away/lock/suspend/menu временно блокируют и отменяют текущий source, не создают catch-up при resume. Оно не включает observation/routine/voice/mic и не отменяет отдельные consent этих функций.

**Статус и стоимость.** Main публикует readonly enabled/capability/phase/blockReason/requestsSent/lastFailure, не credentials/provider internals. Off — consent=false; unavailable capability при offline/no adapter/memory показывает причину и запрещает enable; при enabled priority blocker disabled→quiet→sleeping→away→provider_unavailable→memory_unavailable→busy→none. Фазы waiting/generating/visible отражают actual runtime, visible только реально опубликованная фраза; failed call не error bubble/готовая подмена текста. RequestsSent увеличивается ровно перед actual autonomous event HTTP dispatch, включая окно; отменённый/отклонённый до dispatch source не считает, error после send считает. Это число запросов, не деньги/подтверждённое provider usage; toggle не обнуляет counter, новый session обнуляет. Прежние общий transport/singleflight, backend usage/token budgets и deadlines сохраняются; новых generic minute/hour/session/денежных квот нет. Остановка не обещает отзыва уже выполненного provider billing.

**Один window source.** Pure Domain может вернуть needs_manual_support только из свежего ACTUAL resolved P4 Explore выбора конкретного verified window_top; preview/canStart/Renderer/provider/body geometry не источник желания. Используются существующий Explore target chooser и его RNG, existing external surfaces/проверки Motion, не новый observer/window stack/OS command. Manual candidate допускается до Utility/plan claim только при session opt-in, cached ready/degraded provider, ready memory, fresh active presence, всех awake/quiet/menu/P0–P3 gates, отсутствии current causal Director override и доступном InitiativeBudget; иначе остаются обычные автоматически reachable Explore candidates, не dead winner. Если existing Motion route возможен — обычный Explore. Needs_manual_support означает route отсутствует, но valid top/support/root collision range позволяют существующее ручное drag-release attachment; нет телепорта/автовыполнения обещания. Источник связывает decisionSequence/generation/current Needs (boredom≥60, energy≥30), actual выбранный target. При fresh boredom<40 request теряет актуальность; invalid/critical Needs также закрывают его.

**Admission/темп.** Selection/preparation возвращает execute либо needs_manual_support до durable own-plan claim и actual Explore start. Helper не matching Explore step/start/completion/reward; уже claimed step не переименовывается в просьбу, очередь планов не создаётся. Один volatile request на Main/profile, один high-water decisionSequence и одно actual event attempt, без retries/нового source ID для потерянного исхода. Helper armed изначально; attempt разоружает до fresh boredom<40, toggle не rearm. Дополнительно min20min между help dispatches; existing AUTO-A09-v1 InitiativeBudget2/120000ms/min30000ms проверяется заранее и тратится один раз на actual help dispatch (без fake Activity), не дважды. Новый Activity/helper SocialBid не создаётся: фраза и request card используют existing initiative presentation, ordinary socialStarted не вызывается. No response/decline не меняют Needs/facets/interest/goal reward и не дают pressure/second attempt.

**Target proof.** Только available current ExternalWindowSurfacesPort, same opaque surfaceId/Application tracker epoch/Main policy generation, isValidSupport/window_top, fresh capturedAt age0..300ms и existing geometry/collision/manual-release feasibility. Неоднозначные совпадающие target rectangles исключаются. Tracker подписывается на ТОТ ЖЕ existing port, не добавляя observer/poller: sourceEpoch меняется при замене instance, unavailable/recovery, наблюдаемом исчезновении/смене target ID либо geometry discontinuity; policyGeneration — отдельный Main consent/profile epoch. Порт даёт только capturedAt/revision/capability/surfaces: OS process incarnation/owner не exposed и не объявляются доказанными. Signature включает surface bounds/supportY/kind и screen bounds/collision insets, не номер frame; fresh poll той же identity/геометрии обновляет capture time, НЕ invalidates 3.5s provider response. Tracker epoch/policy/geometry change, stale/unavailable/lost target закрывают request target_lost; новое окно не подставляется вместо старого. Revalidate перед dispatch, после каждого await, перед publication и на authoritative release; cache read не обновляет freshness. Никаких raw app/title/native IDs/provider-supplied targets или новых sensors. Private identity/signature≤512 UTF-16 остаются Main-only.

**Publication и помощь.** Preparing живёт только в existing absolute3500ms event deadline от admission, включая recall≤200ms/transport3000/server2500; caller не продлевает timer. Strict no current causal Director override обязателен не только до Utility/claim, но перед dispatch и publication; новый causal/P3/P0 owner во время подготовки инвалидирует helper text/attempt без replay. При publication goal/source/presence/consent/generation снова совпадают; failure не открывает waiting/платный fallback. Actual publication открывает waiting TTL60000ms и card target preview, не доказательство идеального вопроса. Waiting не резервирует executor: calm/idle допустимы, иной noncalm voluntary action/user command supersedes цель. Новый stronger owner снимает speech, generic P0/P1 закрывает цель кроме точно scoped assisting drag ниже. Pending request не persisted mental state/новый semantic owner, restart не переживает.

Waiting accepted drag начинает assisting, сохраняет **только этот** manual-placement goal до min(waiting expiry, drag start+10000ms); generic input/AI invalidation снимают речь, но не стирают helper goal до landing. Prepublication drag отменяет preparing. Drag не двигается/останавливается из helper controller: P0/P1 physics всегда сильнее. Fulfilled только по реальному свежему existing Motion externalAttachment к тому же target window_top после release, с valid support/root/collision checks; ни Renderer «готово», ни provider слова/положение курсора не успех. Release elsewhere/drag cancel/timeout→cancelled, source loss→target_lost; обычный deadline waiting→unanswered. Другой accepted input/chat, quiet/away/menu/sleep/forced non-drag/lifecycle/revoke закрывают request; «нет» в произвольном тексте не классифицируется, только typed decline с current requestId даёт declined. Closed status показывается10s, затем none; no reaction penalty/автоответа/повторного AI-call за outcome.

**UI и прежняя речь.** В существующей AI settings — native checkbox «Самостоятельные AI-реплики в этой сессии», default unchecked, helper «Использует платные запросы AI-провайдера. Подключение чата не включает инициативу». Показывать «Выключено»/«Ждёт подходящего повода»/конкретный blocker/«Готовит реплику», local requestsSent и безопасный lastFailure; стоимость в валюте не оценивать. Не делать кнопку платного test call. После опубликованной просьбы существующий chat/pet surface показывает текст, native «Не сейчас» и geometry-only mini-screen preview выбранной грани с coarse9-region подписью, без screenshot/title/новой character art. Прямо объяснить manual drag на верхнюю грань окна на схеме; кнопка не обещает auto-move. Preview clipped normalized0..1 rectangle положительной площади, текстовая подпись доступна keyboard/screen reader; controls focusable, stale decline честно сообщает неактуальность. Фраза имеет прежние2000ms lifetime/priority, card остаётся в пределах60s, не воспроизводит старый bubble и не требует ответа.

PreviousInitiative сохраняет только опубликованную phrase/current generation с прежним60s TTL и single-next-chat consumption; target #131 добавляет kind=window_help и authoritative outcome. Matching assisting drag может сохранить только этот bounded metadata slot (без речи/TTL renewal), остальные invalidations прежние. Outcome обновляется локальными facts до capture, text/createdAt не меняются; no slot resurrection после consume/expiry, source/policy/reset/revoke clears. Server получает outcome только при реально следующем ordinary chat, не отдельным call. Window-help/event text не message/fact/summary/new experience, geometry/source refs/попытки игнорирования не сохраняются.

**Wire/security.** В прежнем POST /v1/events один новый exact event={type:window_help_requested,occurredAt:calendarUTC,targetRegion:upper_left/upper_center/upper_right/middle_left/middle_center/middle_right/lower_left/lower_center/lower_right}; event≤512 UTF-8 bytes. Нет goal/source/window IDs/geometry/title/app data/commands/promises/completion. PreviousInitiative window variant exact kind/text1..240/createdAt/outcome по target TS/Python; остальные variants прежние. Backend только формулирует current verified manual-help goal, без controls/доказательства мотива/будущей помощи/программного перемещения; нужный target показан desktop preview, слова не меняют его. Response requestId/text1..240 и caps32KiB/16KiB/output1024/admission/auth/digest/usage/cancel/no retry/RAM cache≤10min/retention прежние. Provider prompt content untrusted; no server source/profile storage. Нет обещания, что свободный model text всегда корректен; language/native acceptance отдельно NOT RUN.

**Проверки реализации #131.** Connected chat/events off; on/off без вызова/повторного source, unavailable/enabled blockers/counter/malformed/stale IPC и abort+late publication, actual first SocialBid→fake provider→visible bubble отдельно от невербального second. Реальный Explore/manual-target path до claim и без extra planner RNG, no help candidate без capability/budget/presence, exact20min/hysteresis, current same-geometry polls через3500ms, target/tracker epoch/geometry loss, valid timed drag→same support release versus elsewhere/prepublication/expired/decline/input/reset. TS/Python strict fixtures для event/previous outcome и transport errors; UI render states/keyboard/preview/cleanup проверяет app-developer. Использовать fake providers/verified surface doubles, no paid calls. macOS reproduction/native #97/live wording/art отдельно human acceptance, техническая готовность не выдаётся за неё.
