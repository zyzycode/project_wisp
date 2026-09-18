# Контракт AI Provider

`IAIProvider` генерирует текст и semantic hints по Character context; финальные behavior decisions и UI ему не принадлежат. Default — локальный offline `MockAIProvider`. Будущий `ExternalAIProviderClient` обращается к backend либо напрямую к LLM через Infrastructure adapter в Main; выбор маршрута не меняет семантический порт. Общая граница backend — [AGENTS.md](../../AGENTS.md#2-архитектура-и-контракты).

## Владение

Application владеет портом, сборкой `AIProviderRequest` и `ProviderResponseIntentMapper`; Infrastructure — provider implementations. Renderer/React/Render не знают provider-specific payload. Domain/Character не получают raw provider DTO.

## Форма интерфейса

`getStatus()` — status/debug/fallback для Application, без network setup/login/user configuration. `generateResponse()` — один semantic response; streaming требует отдельного Architect review.

## Request DTO (Форма запроса)

[ai-provider.interface.ts](../../src/application/ports/ai-provider.interface.ts) использует точный alias `AIProviderCharacterSnapshot = CharacterSnapshot` из [domain types](../../src/domain/character/types.ts); отдельной provider-модели traits нет.

### Правила:

`AIProviderRequest` сериализуем, без React/DOM/Electron handles/Node/SDK objects. `text` санитизируется на Application/Domain boundary; snapshot создаёт доменная фабрика, provider его не мутирует. `recentContext` ограничивает Application, не полный SQLite dump без отдельного memory contract. Tokens/model names/API keys/endpoints/auth/billing в DTO запрещены.

P15-A02 объявляет optional `memoryContext`/response `memoryCandidates` в semantic порте для явного memory-capable режима #56. Правила source validation/recall — [Memory §9](MEMORY_ENGINE.md#9-p15-a02-явные-знания-и-простой-recall), wire — [Backend v2](BACKEND_MEMORY_CONTRACT.md). Existing Mock/v1 их не требуют; v1 adapter не передаёт память и не принимает новые response fields. Model candidates не входят в Character mapper: запись выполняется отдельно после подтверждённого сохранения текущей user/assistant пары.

P17-A04 объявляет optional `previousInitiative` только для явного режима v3: одна опубликованная AI-фраза в RAM≤60s/current generation, чтобы следующий user send имел контекст. Это не user message/долговременная память; v1/v2 её не передают. Отдельные event provider, бюджеты/прерывание, wire и speech — [AI_EVENTS_CONTRACT](AI_EVENTS_CONTRACT.md). User chat использует прежний semantic IAIProvider; только generateEvent имеет text-only result без Character commands.

### Канонический CharacterSnapshot — P17-A03 (#27)

`CharacterStateService.getSnapshot()` → Domain [createCharacterSnapshot](../../src/domain/character/character-snapshot.ts) → `AIProviderRequest.characterSnapshot`. Mapper/provider не дублируют projection/tone synthesis.

| Поле снимка | Источник и формат | Инвариант |
|---|---|---|
| `needs` | Доменный `Needs`: `energy`, `attention`, `play`, `comfort`, опциональный `boredom` | Конечные числа в `[0, 100]`; отсутствие `boredom` допустимо и не превращается в обязательный ноль. |
| `relationship` | Копия `Relationship`: `friendship`, `love`, `loveUnlocked` | Friendship/love в `[0, 1000]`, флаг boolean; provider не изменяет отношения. |
| `personality.presetId` | `CharacterState.personality.id` | Строковый ID пресета. |
| `personality.aiSelfConcept` | `CharacterState.personality.aiSelfConcept` | Строковое самоописание для психологического контекста. |
| `personality.traits` | Четыре числа: `shyness`, `playfulness`, `sensitivity`, `boldness` | Конечные нормализованные значения в `[0, 1]`, не проценты и не `AxisValue` objects. |
| `intimacy` | `flirtiness`, `romanticCharge`, `userConsentEnabled` | Первые два поля в `[0, 100]`, consent — boolean. |
| `synthesizedTone` | Результат доменного `synthesizeEmotionalTone(state)` | Обязательный `SynthesizedEmotionalTone`: `shy`, `sleepy`, `playful`, `curious`, `neutral`, `affectionate`, `flustered`. |

`playfulness`/`sensitivity`/`boldness` копируют `axes.*.current`; [calculateShyness](../../src/domain/character/derived-traits.ts):

`0.45 * sensitivity.current + 0.35 * (1 - boldness.current) + 0.20 * (1 - extraversion.current)`.

При осях `[0, 1]` повторная нормализация не нужна.

Намеренные отличия от `CharacterState`: `personality.id → presetId`; не передаются `displayName`, полные axes/`base`/hard-soft bounds/`plasticity`, `intimacy.boundariesKnown`, `preferences`, `lastUpdated`. Intimacy содержит только три поля таблицы; границы поведения проверяет Character. Нельзя spread-ить полный state; dialogue history идёт отдельно. `synthesizedTone` вычисляется фабрикой, не хранится изменяемым полем state.

Фабрика копирует needs/relationship и создаёт новые personality/traits/intimacy; известные поля — числа/строки/boolean, без mutable ссылок на `CharacterState`/`PersonalityPreset`/`AxisValue`. Alias не вводит deep-readonly/runtime freeze; явно переданный dialogue service snapshot обязан соблюдать тот же ownership и повторно не клонируется.

Это контракт **валидного** Domain state: `Needs` имеет открытый индекс, фабрика shallow-copy и не валидирует traits ranges. Для будущих untrusted inputs Application обязан валидировать известные поля/finite/ranges и исключать произвольные вложения; assertion/`JSON.stringify` недостаточны. Изменение Needs/реализация validator вне P17-A03.

## Dialogue runtime и IPC — P17-A02 (#19)

Runtime перенесён в Main/Application в P17-I01 (#44). DTO: [ipc-contracts.ts](../../src/shared/ipc-contracts.ts) — `DialogueCommandDTO`, `DialogueCommandReceiptDTO`, `DialoguePresentationDTO`, `BrainStateDTO`, `WispApiBridge`.

### Единственный владелец и композиция

| Область | Владелец | Обязанности |
|---|---|---|
| Provider instance | Main composition root | Создаёт один MockAIProvider на lifecycle runtime; будущий внешний адаптер также запускается только здесь. |
| Dialogue runtime/use case | Application, исполняется в Main | Admission, один in-flight, deadline, контекст, нормализация результата, передача stimuli/candidates в Brain. |
| Character state | Существующий Main CharacterStateService | Тот же экземпляр, что у остального Brain; dialogue не создаёт копию semantic authority. |
| IPC handlers | Main | Trusted sender, exact validation, вызов runtime, admission receipt; регистрации один раз с симметричным cleanup. |
| State publication | Существующий BrainStatePublisher | Публикует dialogue вместе с character/activity/motion/visualIntent в полном snapshot. |
| Renderer | Body/UI composition | Draft текста, отправка команды, показ reply/status; не хранит provider context и не вызывает Application services. |

Main создаёт runtime после Character/Brain, до handler; инъецирует provider, **существующий** Character service/arbitration/publisher, monotonic clock, scheduler и ID generator. Clock/scheduler — структурные интерфейсы; Application без Electron/Node/Renderer. Новые dependencies, Renderer singleton и второй Character authority не нужны.

[DialogueRuntime](../../src/application/services/dialogue-loop.service.ts) разделяет await и semantic commit: context/`provider_response`/intent применяются только после generation/deadline проверки. Mapper создаёт candidate для Character gating; прямой `applyBehaviorIntentToAnimation` из dialogue hook удаляется.

### Минимальная IPC boundary

`postDialogueCommand(command)` → фиксированный `wisp:dialogue-command`, typed command как `requestSleepWake`, отдельно от Body observations/их sequence. Provider payload не расширяет `BodyEventDTO`.

| Контракт | Смысл |
|---|---|
| `DialogueCommandDTO` | `send(text)` или `reset`, текущие stream/conversation ID и возрастающая sequence. Locale выбирает Main из конфигурации; UI не передаёт snapshot, историю или provider settings. |
| `DialogueCommandReceiptDTO` | Только accepted/rejected: `busy`, `stale`, `invalid_input`, `unavailable`. Accepted reset возвращает новый conversationId. Receipt не содержит ответа, visual intent или состояния персонажа. |
| `DialoguePresentationDTO` | Текущая conversationId, canSubmit, optional submissionMessage и последний turn: idle/thinking/completed/error. Текст ошибки уже пригоден для UI, без stack trace. |
| `BrainStateDTO.dialogue` | Обязательная projection в полном Brain snapshot; отдельного onDialogueState/getDialogueState нет. |

`BrainStateDTO.dialogue` и `WispApiBridge.postDialogueCommand` обязательны; target wrappers удалены, validators/publisher/preload/Renderer подключены атомарно. Optional dialogue/dual publish запрещены; snapshot без dialogue отклоняется.

Exact-shape validation/copy из `unknown` — [UI §6](UI_SPEC.md#6-brain--body-ipc). IDs trimmed non-empty до 128 символов; sequence — positive safe integer. `send.text` после trim: 1–240 UTF-16 code units, контролы кроме newline/tab запрещены. Reply/message — plain text, не HTML, максимум 2000 code units; provider reply trim + clamp. Unknown keys/enums, empty text, non-finite отклоняются до provider. Malformed → `invalid_input`; untrusted sender → transport refusal без state disclosure.

### Ordering, admission и in-flight

1. Trusted `webContents`, current stream/conversation; чужие IDs → stale.
2. Sequence строго возрастает внутри stream; повтор → stale без provider/stimulus. Valid envelope потребляет sequence даже при busy. Retry только явным действием с новой sequence.
3. Busy send немедленно rejected, без очереди. Admission генерирует requestId, фиксирует generation/text/deadline и атомарно публикует thinking; IPC promise provider не ждёт. Receipt/snapshot могут прийти в любом порядке: UI state только из возрастающих Brain revisions.
4. Ровно один `user_message` stimulus на admission; `think` candidate проходит обычные gates. Отклонение visual reaction не отменяет текстовый запрос.
5. Result проверяется по форме/requestId/current conversation/generation. `now >= deadline` означает timeout даже до timer callback.
6. Единственный terminal commit обновляет context/provider stimulus/candidate/dialogue в одной Brain transaction. Dialogue change — semantic, не motion-only coalescing; повтор snapshot не дублирует UI reply.

UI блокирует resend до receipt, затем `canSubmit` берёт из snapshot. Reject сохраняет draft, accept может очистить текст, но не завершает thinking. Transport refusal снимает локальную блокировку без auto-retry (команда могла быть принята). Receipt старого stream игнорируется.

`submissionMessage` — отдельное локализованное сообщение Application об admission policy, plain text после trim 1–240 UTF-16 units, без controls кроме newline/tab; присутствует только при `canSubmit=false`. При session cap обязательно: «Лимит сообщений на этот запуск исчерпан. Новый диалог станет доступен после перезапуска приложения.»; при временном rate/cooldown допустимо нейтральное «Подожди немного перед следующим сообщением.». При обычном in-flight/idle-unbound/disposed без policy-блокировки поле отсутствует. Нельзя выдавать серверный текст, endpoint, quota counters или секреты за notice.

После сотой фактической отправки runtime публикует notice вместе с `canSubmit=false`, даже если пользователь не пытается отправить 101-ю команду. Полученный сотый reply и его completed turn сохраняются; notice не заменяет reply/error, не становится SpeechBubble, history item, provider context или Character stimulus. Renderer показывает notice отдельно рядом с вводом. Cooldown expiry убирает notice и публикует snapshot; session cap сохраняется через dialogue reset/reload до Main restart. Validator/publisher/Renderer должны принять optional поле атомарно в #54, без нового IPC канала.

### Deadline, fallback и физически незавершённые вызовы

Deadline **15 000 ms от admission**, включая `getStatus()`/`generateResponse()`, по injected Main-monotonic clock. Scheduler adapter изолирует native timer, который только ставит runtime event; await не блокирует physics tick.

| Событие | Presentation / поведение |
|---|---|
| ready или degraded | Вызвать generateResponse в оставшееся время. Валидный status=ok даёт completed/success. |
| offline | Не вызывать generateResponse; completed/fallback с reason=offline и локальной репликой. |
| provider status=thinking без собственного активного запроса, error, rejection | completed/fallback с reason=provider_error. |
| Валидный provider status=fallback | completed/fallback; provider_unavailable → offline, timeout → timeout, unexpected_error → provider_error, остальные причины → degraded. |
| Некорректный response / несовпавший requestId | completed/fallback с reason=invalid_response; raw payload не попадает в UI/context/Character. |
| Deadline истёк | completed/fallback с reason=timeout; thinking немедленно завершён, поздний результат игнорируется. |
| Не удалось сформировать безопасный fallback | error с локальным сообщением; thinking завершён, provider behavior и context не коммитятся. |

Fallback — локальный deterministic catalog, без второго provider call. Валидная provider fallback-реплика отображается, но behavior/mood hints не применяются. Только success создаёт `provider_response`/candidate через Character. Transport error — локальная UI-ошибка без Character reaction.

Terminal/reset/dispose освобождают только thinking Activity своего requestId, не чужую Activity/forced Motion. Текущие gates определяют reply/idle; `thinking_loop` не ждёт Skin completion.

Cancellation API нет. Timeout/reset отменяют запрос **логически**, не Promise физически. Один execution guard сохраняется до settlement старого getStatus/generateResponse; новые calls запрещены, `canSubmit=false`. Settlement освобождает guard, публикует `canSubmit=true`, не принимает старый result; после позднего getStatus generateResponse не вызывается. Вечное зависание блокирует resend до app restart, но не UI/Motion. Cancellation внешнего adapter требует контракта; накапливать retired calls запрещено.

### Контекст, reset и lifecycle

- Volatile context — последние **три завершённые пары** user/reply (шесть сообщений); request получает копию, current userMessage отдельно. Пара добавляется атомарно после success/показанного fallback; error/reset/cancel не добавляют половину. User ≤240, reply ≤2000.
- P15-A01: [Memory §5](MEMORY_ENGINE.md#5-история-подбор-и-ai-context) задаёт будущую persistent hydration только локального Mock в #7; для network provider сохраняется volatile policy этой секции до #55/#56. Лимит хранения не равен лимиту отправляемого context. Полный memory reset отдельный от dialogue reset, его generation barrier — [Memory §6](MEMORY_ENGINE.md#6-полный-reset-и-защита-от-поздних-записей).
- Reset допустим при thinking: новая conversationId/generation, пустой context, turn=idle, отмена deadline. Needs/relationship и уже применённый user_message не откатываются; execution guard ждёт settlement.
- Reload/replacement webContents меняет stream и сбрасывает conversation/context как reset. Старые commands/receipts/results не переносятся. React remount только переподписывается, не сбрасывает Main.
- Window close/shutdown → dispose: invalid generation, cleanup timers/subscriptions, остановка UI publication. Guard принадлежит Main lifecycle и переживает пересоздание окна; новый запрос ждёт settlement. App restart → idle.
- Drag/fall/direct input не ждут provider: gates могут прервать thinking/talking animation, но текстовый запрос продолжается. Reply не восстанавливает прежнюю Activity и не обходит current gates; Skin completion в dialogue не участвует.

### Implementation consequences и проверка

Provider creation из DesktopPet и recentContext из useDialogueLoop принадлежат Main/Application; hook — только typed command + snapshot UI wrapper. Exact validators/handler/DTO/lifecycle используют существующий Brain publisher; raw provider result через IPC не передавать. Network adapter, streaming, provider settings и persistence вне P17-A02.

Fake scheduler/deferred provider регрессии: duplicate/resend; timeout обеих await стадий; late success/rejection после reset/reload/dispose; result ровно на deadline; malformed/requestId; bounded whole pairs; оба receipt/snapshot порядка; guard release; отсутствие Renderer provider imports/direct animation dispatch; once-only terminal commit и сохранение forced Motion. Developer: typecheck + npm test.

## Response DTO (Форма ответа)

`AIProviderResponse` — semantic result, не окончательный behavior/clip/asset.

### Обязательные требования:

- `replyText` (`reply.text`) непустой, для SpeechBubble/history.
- Optional `suggestedBehavior` — из provider-подмножества `BehaviorIntentKind` [Behavior contract](BEHAVIOR_INTENTS.md). `drag`/`land` запрещены first-party providers, mapper отбрасывает их в fallback. Финальное решение — Character по Needs/Relationship/cooldowns/quiet/sleep/user priority.
- `reply.tone`: отдельный `AIProviderTone`, не `CharacterSnapshot.synthesizedTone`; поля `suggestedTone` нет. Character может игнорировать hint.
- Без CSS/React names, SVG paths, sprite sheets/asset paths, frame indexes/fps.

## Thinking и latency

<a id="правила-1"></a>

`idle → thinking → ok | fallback | error`. Mock latency локальна; UI получает provider-neutral presentation через Application/IPC. Direct drag/click всегда приоритетнее provider.

## Errors и offline fallback

<a id="правила-2"></a>

Application нормализует `AIProviderFallbackReason`: `empty_input`, `message_too_long`, `unsupported_input`, `provider_unavailable`, `timeout`, `unexpected_error`. Mock детерминированно отвечает на empty/long/unsupported input; offline — штатный режим. Ошибки внешнего adapter превращаются в нейтральные fallback/error без технических подробностей в UI.

## Реализации

### `MockAIProvider`

Полностью offline, без API keys; локальные реплики учитывают snapshot (shyness/energy/friendship) и симулируют thinking/latency.

### `ExternalAIProviderClient`

Infrastructure adapter, создаваемый Main, для backend API v1 ниже. Адаптер преобразует transport DTO в `AIProviderResponse`, валидирует недоверенный ответ и скрывает transport/provider internals от Application и Renderer. Backend владеет своими вызовами LLM; семантический порт не даёт доступа к серверной БД. Существующие single-flight, fallback и защита от поздних результатов сохраняются. Прямой LLM-адаптер допускается общей архитектурой, но не реализуется как автоматический обход backend или его квоты.

## Desktop ↔ backend v1

Внешний протокол вынесен в самостоятельный [BACKEND_API_CONTRACT.md](BACKEND_API_CONTRACT.md): транспорт, диапазоны, HTTP-статусы и общие JSON fixtures. [Wire types](../../src/application/ports/backend-ai-contract.ts) не имеют импортов/алиасов из Domain или IAIProvider. Backend использует их независимо от внутренней модели desktop; adapter явно преобразует canonical CharacterSnapshot и provider DTO. Этот раздел владеет только клиентским lifecycle и policy.

### Projection и допустимые решения

Adapter создаёт явную wire projection без произвольных Needs keys, памяти, экранных данных и координат курсора. self-concept обрезается до 500 code units; locale ru/en, неподдерживаемая настройка даёт ru. Последние три полные пары volatile context отображаются из user/wisp в user/assistant; текущее user добавляется последним. Snapshot и ranges проверяются до отправки; reset очищает локальный контекст. Wire shape не меняется вслед за изменением Domain.

Валидный текст без decision отображается в semantic response с suggestedBehavior=respond, confidence=1 (это transport default, не достоверность текста). Wire decision явно отображается в локальные provider enums; неизвестный/невалидный hint удаляется целиком. Модель не управляет FSM, физикой или сохранёнными числовыми состояниями. После mapping сохраняются ProviderResponseIntentMapper → IBehaviorAdmission → Character, current generation, P0–P5 и once-only commit. play выбирает доступную локальную Activity, а не обещает игру/поимку курсора; sleep/wake/quiet остаются candidates, не меняют настройки и не обходят P2.

Wire-valid `decision.mood = playful` не имеет точного соответствия в `AIProviderSuggestedMood`: adapter опускает только `suggestedMood`, сохраняя text/behavior/confidence и допустимый tone. Не подменять playful на curious и не расширять Domain enum ради транспорта. Это явная частичная projection валидного decision, а не обработка malformed hint; прочие общие mood значения отображаются один к одному.

### События

| Событие | Вызов модели v1 |
|---|---|
| Принятая typed send(text) пользователя | Ровно один после validation/current IDs, single-flight и локальных ограничений. |
| Reset, reload, dispose | Ноль; инвалидируют generation и результат. |
| Cursor sample/dwell, старт/поимка/промах/конец игры | В v1/v2 ноль; локальные decisions и каталог реплик. Только явно включённый v3 post-game event описан отдельно. |
| Autonomy pulse, idle, Needs, sleep/wake, pet/drag, Motion/Skin/frame | Ноль. |
| Собственная социальная инициатива | Локальная; необязательная речь v3 — [P17-A04](AI_EVENTS_CONTRACT.md), без ожидания сети в Activity. |

Нет polling, автоматического приветствия при запуске, фонового summary или второго LLM-вызова на fallback. Будущие сетевые события не маскируются под синтетическое пользовательское сообщение.

### Клиентские ограничения и deadline

[AIRequestPolicy](../../src/application/ports/ai-request-policy.ts) — desktop-only policy: один in-flight, 6 отправок за скользящие 60 000 ms Main-monotonic time и 100 за Main session. Это не серверная quota и не гарантированный доступный бюджет backend. Application проверяет их атомарно вместе с admission. Validation/busy/local rejection/Mock бесплатны; фактическая отправка, включая ошибочную, расходует единицу. Reset/reload/quiet не обнуляют счётчики, restart обнуляет только клиентский session guard.

Минутный интервал (now−60000, now]; левая граница истекает. Session cap → unavailable и canSubmit=false до restart с локальным сообщением. Очереди нет, автоматических retries — 0. При новом ручном обращении Main создаёт новый UUID; bounded server dedup/replay определён в §5 wire-контракта и не вводит клиентские retries.

Desktop transport timeout 12 000 ms от fetch start, runtime deadline 15 000 ms от dialogue admission. Adapter abort-ит fetch и settle на timeout; reset/dispose логически инвалидируют результат, существующий guard держится до settlement. getStatus читает локальную конфигурацию/cooldown без network call. Серверный upstream deadline рекомендуем укладывать в клиентский transport timeout; клиент не полагается на физическую отмену вычисления у провайдера.

### Обработка HTTP на desktop

HTTP/code mapping определён только [wire-контрактом](BACKEND_API_CONTRACT.md#3-http-и-ошибки). Timeout → AIProviderFallbackReason.timeout; сеть/429/503 → provider_unavailable; остальные ошибки → unexpected_error. Невалидный wire envelope, JSON, requestId или HTTP/code mismatch отклоняет promise и даёт runtime provider_error fallback. Невалидный semantic response другого provider остаётся runtime invalid_response. Безопасный текст берётся из локального каталога.

429 блокирует новые sends по optional retryAfterMs; при отсутствии/невалидном значении desktop использует локальный cooldown 60 000 ms. Это не предположение о периоде серверной квоты. Для network/TLS/502/503/504/неожиданного HTTP или malformed response cooldown 30 000 ms; для 400/409/413 auto-retry также отсутствует. Истечение cooldown только разрешает ручной send, не посылает новый запрос.

### Implementation consequences и проверка

Wire DTO и клиентская policy объявлены; HTTP adapter и backend подключаются отдельной реализацией. Существующих DialogueCommandDTO, receipt unavailable и presentation fallback/error достаточно: новый IPC канал и передача transport/quota/auth в Renderer не нужны. canSubmit учитывает локальные guard/cooldown; истечение публикует snapshot через существующий scheduler, без network polling. Draft сохраняется при rejection; server error после admission завершает turn безопасным сообщением.

Desktop реализует policy, exact validators/projection и aborting adapter через Main DI; при отсутствии backend URL остаётся Mock. Backend реализует endpoint/schema, prompt mapping и validation model output; серверные admission/retention и последствия аудита определены в [BE-A01](BE_A01_RESULT.md) и §5–6 wire-контракта. Клиентские лимиты не становятся серверными; закрытая alpha не добавляет auth/quota в wire.

Общие JSON fixtures находятся в wire-контракте. Developer добавляет проверки ranges/enum/projection, text-only и invalid hint, malformed/oversize, ID mismatch, локальных minute/session boundaries, absence auto-retry, timeout/late/reset/dispose, сохранения локального ввода и отсутствия утечки экранных данных. Windows smoke включает HTTPS/offline/timeout и работающие drag/курсор; Linux/macOS — capability fallback. Typecheck затем npm test по developer gate; независимый reviewer проверяет контракт отдельно.

## Запрещённые знания provider-а

[Изоляция](README.md#общие-границы): provider не знает React/DOM/CSS, assets/sprites, Electron/OS handles, SQLite tables.

## Граница mapper-а

`AIProviderResponse → ProviderResponseIntentMapper → BehaviorIntent`: Application нормализует hints/unknown values в safe fallback; финальное решение принимает `CharacterEngine`.

## ARCHITECT RESULT — P17-A03 (#27)

Принято: canonical snapshot/alias без code delta; фабрика и ownership сохраняются. Обязательные implementation consequences и ограничения validator — в разделе «Канонический CharacterSnapshot». Provider/services/network/dependencies не менялись; sprites: none. На момент решения проверены types/factory/alias/request, ссылки/diff/450 строк; docs-only без typecheck/npm test, следующий gate — reviewer.

## ARCHITECT RESULT — P17-A02 (#19)

Принято: один Main/Application runtime, bounded volatile context, single-flight и единый Brain stream. Объявлены target command/receipt/presentation/bridge; обязательные injection/lifecycle/order/deadline/fallback/reset/cutover — в разделе «Dialogue runtime и IPC». На момент architect gate runtime ещё не мигрирован (последующее P17-I01 описано выше). В рамках P17-A02 зависимости, сетевые интеграции, persistence, backend и settings не менялись; sprites: none. Typecheck/ссылки/лимит/diff прошли, tests — при реализации. Gate: reviewer контрактов → app-developer.
