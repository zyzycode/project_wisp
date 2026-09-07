# Контракт AI Provider

`IAIProvider` генерирует текст и semantic hints по Character context; финальные behavior decisions и UI ему не принадлежат. Default — локальный offline `MockAIProvider`. Будущий `ExternalAIProviderClient` вызывает LLM прямо из Main; без backend/proxy/server/внешней БД.

## Владение

Application владеет портом, сборкой `AIProviderRequest` и `ProviderResponseIntentMapper`; Infrastructure — provider implementations. Renderer/React/Render не знают provider-specific payload. Domain/Character не получают raw provider DTO.

## Форма интерфейса

`getStatus()` — status/debug/fallback для Application, без network setup/login/user configuration. `generateResponse()` — один semantic response; streaming требует отдельного Architect review.

## Request DTO (Форма запроса)

[ai-provider.interface.ts](../../src/application/ports/ai-provider.interface.ts) использует точный alias `AIProviderCharacterSnapshot = CharacterSnapshot` из [domain types](../../src/domain/character/types.ts); отдельной provider-модели traits нет.

### Правила:

`AIProviderRequest` сериализуем, без React/DOM/Electron handles/Node/SDK objects. `text` санитизируется на Application/Domain boundary; snapshot создаёт доменная фабрика, provider его не мутирует. `recentContext` ограничивает Application, не полный SQLite dump без отдельного memory contract. Tokens/model names/API keys/endpoints/auth/billing в DTO запрещены.

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
| `DialoguePresentationDTO` | Текущая conversationId, canSubmit и последний turn: idle/thinking/completed/error. Текст ошибки уже пригоден для UI, без stack trace. |
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

Будущий Main/Infrastructure adapter прямого LLM-вызова; требует Architect review. Без backend/proxy/server/внешней БД/сети в Renderer. Credentials policy, auth/API keys и SDK вне P17-A02.

## Запрещённые знания provider-а

[Изоляция](README.md#5-общие-архитектурные-границы-и-изоляция-clean-architecture): provider не знает React/DOM/CSS, assets/sprites, Electron/OS handles, SQLite tables.

## Граница mapper-а

`AIProviderResponse → ProviderResponseIntentMapper → BehaviorIntent`: Application нормализует hints/unknown values в safe fallback; финальное решение принимает `CharacterEngine`.

## ARCHITECT RESULT — P17-A03 (#27)

Принято: canonical snapshot/alias без code delta; фабрика и ownership сохраняются. Обязательные implementation consequences и ограничения validator — в разделе «Канонический CharacterSnapshot». Provider/services/network/dependencies не менялись; sprites: none. На момент решения проверены types/factory/alias/request, ссылки/diff/450 строк; docs-only без typecheck/npm test, следующий gate — reviewer.

## ARCHITECT RESULT — P17-A02 (#19)

Принято: один Main/Application runtime, bounded volatile context, single-flight и единый Brain stream. Объявлены target command/receipt/presentation/bridge; обязательные injection/lifecycle/order/deadline/fallback/reset/cutover — в разделе «Dialogue runtime и IPC». На момент architect gate runtime ещё не мигрирован (последующее P17-I01 описано выше); без dependencies/network/persistence/backend/settings, sprites: none. Typecheck/ссылки/лимит/diff прошли, tests — при реализации. Gate: reviewer контрактов → app-developer.
