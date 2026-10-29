# Контракт Autonomy Engine

P0–P5, Utility eligibility/scoring/arbitration, cadence/trace/safety. Это pure Character policy + Application orchestration, не отдельный runtime actor/второй behavior owner. Отказ от XState — [ADR-015](../adr/ADR-015-utility-ai-without-xstate.md).

## 1. Владение

- Character (Domain): semantic gating/P0–P5/P4 и один resolved BehaviorIntent; не Activity selection/physics/frames/clocks.
- Brain (Main/Application): semantic state/Activity timeline/Needs/authoritative motion projection; оркестрирует pure engines с explicit time и публикует полный BrainStateDTO, не является новым Domain engine.
- Application: normalization, immutable snapshot, finite candidates, `opportunityAtMs`, сериализация transitions; не semantic weights.
- Body: ordered snapshots, input/visual reflexes; Skin: BodyVisualState render. Behavior/Activity/Brain progression им не принадлежат. [Общий ownership](README.md#4-матрица-межмодульных-контрактов-кто-от-кого-зависит).

## 2. Единственная цепочка решений

Boundary input → Application mapper → finite candidates + opportunity snapshot → Character gate/P4 policy → resolved BehaviorIntent → Behavior Brain → Activity Runner → Brain timeline/state → Body → Skin.

Candidate/Resolved — стадии одной public формы, не новые DTO. Mapper нормализует user/system/catalog/provider, Character возвращает максимум один intent. Forced facts идут независимо в Motion: отменяют Activity в Application transaction, попадают MotionEvent в следующий полный Brain/visual state. Public physical lifecycle intent разрешает Character, не отменяя уже случившийся факт.

### 2.1. Activity timeline не зависит от визуального playback

Runner переключает фазы только в Brain transaction: explicit Main-monotonic nowMs, Brain guard/locomotion/interruption. Bounded phase хранит phaseStartedAtMs/phaseEndsAtMs; `nowMs >= phaseEndsAtMs` атомарно выбирает следующий step/revision.

Skin completion/rejection/fallback/interruption не Activity events. Нет Renderer callback ожидания, копии clip duration или animation watchdog. BodyEventDTO только input/observation, не visual outcome/cadence gate. [IPC/time](UI_SPEC.md#6-brain--body-ipc).

## 3. Safety order P0–P5

Единственная behavior rank scale; [AnimationPriority](ANIMATION_ENGINE.md) — отдельная visual policy.

| Rank | Источник | Arbitration и interruption |
|---|---|---|
| P0 forced physics | invalid support, fall, collision, landing | Не участвует в Utility; invariant не отклоняется и отменяет active Activity. |
| P1 direct user / causal continuation | drag, click, pet, explicit command | Отменяет P2–P5; airborne drag начинается после atomic physics step. |
| P2 critical Character state | required sleep/wake | Определяется только Character contract; ждёт P0/P1 и отменяет P3–P5. |
| P3 reactive / provider | admitted AI, затем local spook/cursor reaction | После gating отменяет P4–P5; AI выше local P3, вне Utility. |
| P4 autonomous | Explore, optional Rest, calm, самостоятельная игра/Zoomies, SocialBid | Заменяет P5; local peers не заменяют active P4 по умолчанию. |
| P5 ambient | blink, micro-idle | Прерывается всеми higher ranks. |

[Character sleep/quiet](CHARACTER_ENGINE.md#21-каноническая-семантика-сна-и-пробуждения) владеет thresholds/семантикой; [Motion](MOTION_ENGINE.md#8-авторитет-позиции-кто-двигает-окно) — ordering/возврат position authority.

## 4. P4 opportunity и нормализация

После forced landing следующая opportunity использует только semantic recovery из
`LANDING_RECOVERY_MS`: 800 мс для soft/stumble и attachment, 1600 мс для crash.
Обычная idle-задержка 5–11 с к recovery не добавляется. Используется существующий
отменяемый таймер coordinator; Skin completion не участвует в возобновлении.

Причины opportunity: Activity terminal/cancel; Character threshold crossing; quiet/settings change; candidate; редкий configured pulse.

Application один раз нормализует всё до transaction boundary: возрастающий `decisionSequence`, monotonic `opportunityAtMs`, immutable Character, active Activity/rank, bounded cooldown/repetition, normalized environment/fresh reactive signals, finite ordered candidates, versioned tuning. Catalog/normalization задают порядок независимо от async callback arrival.

Domain не читает clock. Pulse не привязан к physics/animation/render, не прерывает peer P4 и не вызывает provider. После shutdown/window destruction opportunities запрещены.

## 5. Допустимые и запрещённые inputs

Только normalized Character Needs/tone/personality/relationship/intimacy, validated preference projection по [Character §9.1](CHARACTER_ENGINE.md#91-char-a01-следующий-локальный-набор-предпочтений), готовые quiet/sleep gates, Activity rank/cooldown/repetition, [Perception geometry/signals](PERCEPTION_ENGINE.md), candidate `source`/`priority`/`requestId` и catalog identity.

[Запрещены](README.md#5-общие-архитектурные-границы-и-изоляция-clean-architecture): raw provider/memory text, DOM/React/Electron handles, assets/clips/frames, Date.now/Math.random, renderer/physics tickrate, mutable CharacterState.

## 6. Eligibility

Hard gates **до** P4 scoring:

```text
eligible(c) = catalog(c)
           AND safety(c)
           AND characterGate(c)
           AND cooldown(c)
           AND environment(c)
```

Проверяются существующий BehaviorIntentKind, current semantic compatibility/safety, Activity-owned cooldown и normalized environment. Failed candidate исключён; score не компенсирует gate. Reason — stable machine diagnostic code, не новый IPC/provider/persistence contract.

## 7. Scoring и arbitration

Каноническая локальная политика — взвешенная полезность (weighted Utility), реализованная в [local-activity-policy.ts](../../src/domain/behavior/local-activity-policy.ts); используется взвешенный селектор действий.


Для eligible семейства baseline `w0 = need × personality × repetition`; для ineligible `w0=0`. Факторы — конечные неотрицательные versioned функции Needs, Character traits/relationship и затухающей истории. Environment/quiet/cooldown служат gates. Вес не probability и не обрезается до 1: нормализация выполняется суммой весов. Единственный выбор — по накопленным весам в стабильном порядке calm, Explore, Rest, play, SocialBid, используя один явный RNG draw `[0,1)`. На точной правой границе выигрывает предыдущее положительное ведро; zero-weight rows не выигрывают. Relative position внутри calm bucket переиспользуется для semantic pose без дополнительного draw.

Расширение предпочтений характера добавляет multiplier по [Character §9.1](CHARACTER_ENGINE.md#91-char-a01-следующий-локальный-набор-предпочтений) к Explore/SocialBid; остальные базовые веса и гейты сохраняются. Ни LLM, ни Renderer не задают numerical weights.

При нулевой сумме/пустом наборе — safe `idle` через обычный Character gate. Результат — максимум один resolved intent. P0–P3 не участвуют в score; P5 не P4 fallback, запускается лишь после общего safety order. Legacy candidate resolver не становится вторым одновременно работающим P4 selector.

## 8. Детерминизм

Одинаковые snapshot/ordered candidates/history/tuning/decisionSequence **и явный RNG draw/seed** → одинаковые eligibility/weights/winner. Policy immutable, не планирует переоценку. Вариативность local selector уже использует injected PRNG; fixture/trace фиксирует draw либо seed и sequence. Wall-clock seed/provider randomness запрещены; добавление preference не расходует ещё один draw.

Application исполняет одну decision transaction одновременно; новые inputs идут в следующий sequence. Resolved intent публикуется после полной transaction, без промежуточных candidates для Brain selection.

## 9. Diagnostic trace

Внутренний trace каждой P4 transaction: reason/time/sequence; ordered identities/sources; eligibility/reasons; factors/weights; bucket boundary/winner/fallback; tuning version и явный draw либо seed/sequence. Target preference multiplier trace — [Character §9.1](CHARACTER_ENGINE.md#91-char-a01-следующий-локальный-набор-предпочтений).

Без raw provider/memory text, OS/window identifiers, mutable refs. Public IPC/persistence/provider exposure требует отдельного Architect review/privacy boundary.

## 10. Coexistence и safety invariants

Сохраняются owners §1: Character — единственный semantic owner, Behavior Brain не сравнивает разные kinds, Runner не ждёт Skin и не становится параллельной FSM, Motion не выбирает behavior. Body/Skin не создают/не гейтят cadence. Provider необязателен, pulse его не вызывает. Shutdown отменяет scheduler без catch-up.

Новый public intent kind, IPC/port или Character threshold требует отдельного Architect review.

## 11. Проверяемые свойства

Повторяемость weights/bucket boundaries/fallback при одинаковом RNG; один resolved/sequence; P0–P3 вне Utility; peer P4 не прерывается pulse; нет копий sleep/quiet thresholds; offline/present provider candidates проходят общую boundary; trace не меняет outcome/контракты; render/animation/physics ticks не создают скрытую cadence.

<a id="12-auto-a09-admission-и-владение-ai-занятием"></a>
## 12. Admission и владение AI-занятием

Спецификация admission и владения занятиями, инициированными AI.
Канонические типы: [`behavior-admission-port.ts`](../../src/application/ports/behavior-admission-port.ts).
Это boundary существующего Brain, а не новый scheduler, provider protocol или Domain dependency на Application.
Domain получает нормализованные значения; provider IDs и generation проверяет Application.

### 12.1. Порядок и актуальность

Обязательный порядок: **P0 → P1 → P2 → admitted provider P3 → local P3 → local P4 → P5**.
Rank задаётся причиной запуска и ownership, не только `ActivityDefinition.priority`.
Одна и та же игра может быть user P1, provider P3 или самостоятельной P4.
Входное `priority: critical` не повышает полномочия provider.
Local cursor reaction, Zoomies, SocialBid и pulse не отменяют provider-owned run.
Физическая опасность становится P0, а не маскируется под local spook.
P1 действует на время прямого взаимодействия/его causal continuation, а не навечно после клика.
Ответ AI на прежнее сообщение не наследует P1.

`ProviderBehaviorOffer` содержит Main-owned request identity, generation и время.
`expiresAtMs = requestedAtMs + offerTtlMs`; deadline не продлевается при получении/откладывании.
Все числа конечны, времена неотрицательны и `requestedAtMs <= receivedAtMs <= nowMs < expiresAtMs`.
Generation — неотрицательное целое, IDs непустые bounded строки (до 128 символов).
Offer проверяется на текущие conversation/generation/request, duplicate и enabled lifecycle.
Request должен соответствовать успешно завершённому текущему turn, не retired timeout/fallback.
Повторная доставка той же identity не создаёт повторного admission даже после завершения run.
Application хранит bounded ledger текущей generation; obsolete generations отклоняются до ledger lookup.
При вытеснении старых IDs принимается только identity текущего завершённого turn;
поэтому удаление ledger entry не разрешает повтор старого request.

Character проверяет sleep/quiet, Needs, intimacy, cooldown и общий initiative budget для навязчивых действий.
Activity selection проверяет совместимость и достижимость по текущему environment snapshot.
Проверки выполняются до отмены local run и повторяются непосредственно перед deferred start.
Raw provider target/координаты не исполняются: локальный planner выбирает доступную цель.
Нет compatible Activity — `no_activity`, local run продолжает жить.
Нет explicit допустимого behavior hint — `no_behavior_command`: reply остаётся в dialogue presentation.
Fallback/unknown hint не создаёт приоритетное занятие и не включает quiet.
Явный `respond` допустим как конечное semantic занятие; текст сам по себе не требует talking interrupt.
Provider не инициирует `drag`, `land`, `wake` и изменение quiet mode.

### 12.2. Request, admission, execution

| Стадия | Значение |
|---|---|
| received | Ответ доставлен, side effects занятия отсутствуют. |
| rejected | Финальный отказ с `BehaviorAdmissionRejection`; retry той же identity запрещён. |
| admitted | Кандидат разрешён сейчас; receipt ещё не доказывает start или completion. |
| started | Создан один `runId` и `OwnedActivityRun`; ownership фиксируется до terminal. |
| not_started | Принятый deferred offer потерял gate/срок; один terminal event без Activity feedback. |
| terminated | Один `ActivityResult` для started run: completed/cancelled/failed. |

На Brain существует максимум один active run и один deferred offer. Второй AI offer получает
`active_provider`, не вытесняет первый и не образует очередь. Ledger идентичности общий для
immediate/deferred пути. Receipt, lifecycle event и diagnostic trace не являются новым IPC.

При grounded добровольном walk, calm phase, игре или optional nap разрешено immediate cancel/start
в одной transaction; visual clip не удерживает ownership. Во время уже начатой directed arc,
climb/hang transition допускается safe deferred до authoritative grounded support + окончания
landing settle/recover. Runner не выпускает следующую добровольную фазу после такой границы.
Срок старта: `startBeforeMs = min(expiresAtMs, admittedAtMs + maxSafeDeferMs)`.
На `nowMs >= startBeforeMs` offer завершается `expired` либо `defer_timeout` без запуска.
Истечение не обрывает физику и не телепортирует персонажа.

Новый P0, P1, P2, quiet/disable/reset/dispose отзывает несовместимый deferred offer.
Уже текущая безопасно завершаемая voluntary arc не считается новым конфликтом P0;
внешняя потеря опоры/collision считается. При уже активной forced physics offer отклоняется.
На общей временной границе порядок: P0/P1 → Character P2/mode gates → deadline invalidation →
safe completion/start → один local opportunity. На deadline start/completion не выигрывает у timeout.

`executionEndsAtMs = min(expiresAtMs, startedAtMs + maxProviderRunMs)` ограничивает AI ownership.
Completion освобождает ownership; user/physics/critical gate отменяет run;
expiry/run timeout использует `ActivityResult.cancelled` с `step_timeout`, а не новый status.
При timeout в воздухе semantic run завершается, Motion доводит forced lifecycle самостоятельно.
Provider sleep после P2 threshold уступает Character-owned vital sleep с новой identity;
AI timeout не будит обязательный сон. Provider не владеет бессрочным full sleep.

Terminal transaction применяет feedback/history/cleanup и создаёт ровно одну coalesced возможность
локального выбора после снятия blockers. Старое занятие и его маршрут никогда не resume.
Если P0/P1/P2, menu или disable ещё блокируют выбор, сохраняется факт необходимости переоценки,
а не очередь намерений; при снятии blocker используется свежий snapshot.

Provider thinking/offline/timeout не останавливает autonomy cadence или Needs.
Thinking — только dialogue presentation, не idle owner. Принцип single-flight сохраняется:
timeout/reset retires result, но до settlement реального promise busy остаётся true.
Reset/reload/dispose инвалидируют generation и её offer/run; поздний result не допускается.
Periodic provider polling и параллельные запросы этим контрактом не вводятся.

Сетевые события и request/token budget определены в [AI Provider](AI_PROVIDER_CONTRACT.md#desktop--backend-v1). InitiativeBudget ограничивает навязчивость локальных действий и не заменяет бюджет backend; без opt-in cursor episodes и SocialBid модель не вызывают. Явно включённый режим событий ([AI Events](../../../docs/contracts/AI_EVENTS_CONTRACT.md)) добавляет только bounded event speech после отдельных causal gates, не provider-owned Activity; локальная selection/runner не ждёт ответа.

<a id="13-auto-a09-локальная-жизнь-и-ненавязчивость"></a>
## 13. Локальная жизнь и ненавязчивость

Utility использует существующие Needs/history/environment/personality, без новых шкал.
`boredom` и openness усиливают Explore; play и playfulness — допустимую игру;
energy/comfort и independence — calm/Rest; attention/extraversion/relationship — SocialBid.
Это направления влияния, не новые thresholds. Hard gates всегда применяются первыми.
P2 thresholds и wake принадлежат Character; необязательный Rest не может отсрочить P2.

Переоценка: terminal feedback, sleep/wake threshold, смена quiet/settings, освобождение P0/P1,
потеря/появление usable environment, eligible свежий cursor episode, provider offer и редкий pulse.
Повтор cursor samples лишь обновляет observation. Cooldown/budget expiry обнаруживается этим же
pulse либо ближайшим уже имеющимся opportunity; отдельный scheduler не создаётся.
Серия событий одной transaction сворачивается в один decisionSequence после Character update.

| Семейство | Existing kind / semantics |
|---|---|
| Calm | `idle`, bounded спокойное занятие с выбранной semantic pose; не P5 blink и не quiet toggle. |
| Explore | `wander`, существующий route/target planner без перепроектирования. |
| Rest | `sleep`, optional nap; P2/full user sleep сохраняют Character rules. |
| Игра | `play`, самостоятельные Zoomies или user/provider game; один executor. |
| Cursor interest | `play`, прежний stationary Observe Cursor; отдельно выбранная bounded approach Activity. |
| SocialBid | `play` как дружелюбное невербальное обращение; отдельная Activity, не LLM reply. |

Новый public kind не нужен. Activity family/catalog identity выбирается внутри kind по
нормализованному контексту; `reason` — только диагностика, не transport semantic variants.
Calm pose передаётся существующим `AnimationIntent.kind` и `BrainVisualIntentDTO.kind` до Skin.
Walk/run/crawl остаётся typed gait до Motion command; run не подменяется wander speed.

SocialBid доступен без cursor event: заметить пользователя → существующий жест/безопасное короткое
сближение → bounded ожидание → terminal. Без свежей безопасной цели используется stationary gesture.
Для сближения действуют те же same-support, 160 DIP и 6000 ms пределы, что для cursor approach;
затем отдельное ожидание не дольше `socialWaitMaxMs`, повтор маршрута внутри эпизода запрещён.
Реальный pet input завершает ожидание и проходит P1; отсутствие ответа не меняет relationship,
не создаёт штрафа, текста упрёка или повторного требования. Сам жест не насыщает attention.
Отсутствие pet input означает только отсутствие контакта. Системный idle/return — отдельный сигнал [Perception §7.1](PERCEPTION_ENGINE.md#71-системный-idle-и-вероятное-отсутствие-afk-a01), без вывода AFK из этого ожидания.

Общий `InitiativeBudgetSnapshot` расходуется один раз при старте unsolicited cursor gesture/approach
или SocialBid, включая provider-инициативу. Gaze-only, спокойная одиночная игра и ручной P1 бесплатны.
Отказ до старта не расходует budget. Отмена после старта не возвращает token.
Помимо existing Activity cooldown требуется `nowMs >= nextEligibleAtMs` и свободный token
фиксированного окна; граница окна вычисляется по Main time, без interval timer и catch-up эпизодов.
При quiet/menu/disable сохраняются budget/cooldown и сбрасываются pending initiatives/dwell.
Resume допускает один свежий выбор, не накопленные приветствия.

### 13.1. Системный idle и одноразовый return

`active/inactive/unknown` сохраняют существующий baseline; inactive не означает недовольство/отказ. `probably_away` запрещает новые unsolicited SocialBid, cursor gesture/approach/game и event/observation инициативы через existing eligibility; отменяет уже активные unsolicited social/cursor episodes и их pending event/observation результаты без отрицательного feedback. Спокойные одиночные calm/Explore/Rest/play и gaze продолжаются. User P1, direct chat и touch ответ проходят свои обычные gates: away меняет unsolicited `allowed`, но не `touchAllowed`, отмена pending избирательна по причине. Away не quiet, не sleep и не настройка пользователя. Сигнал idle не передаётся provider.

Return — максимум один **local P3** кандидат после provider P3, перед обычным local P3/P4; выше P0/P1/P2 не поднимается. Причина внешняя и свежая, поэтому допускается существующая safe boundary cursor reactions: пустой runner либо local calm с idle/look-around, без Motion/user/provider/deferred ownership. Другую активную Activity return не прерывает. Character sleep/critical/intimacy, quiet/menu/enabled, Activity cooldown и общий InitiativeBudget проверяются до отмены calm и снова перед start в той же transaction. Отказ/занятость/исчерпанный budget теряют кандидат, без safe-defer, retry, очереди или старта по cooldown expiry.

Используется существующий `social_bid` Activity/Runner с теми же identity и notice→wave→bounded wait; для return rank `P3_reactive`, обычный Utility SocialBid остаётся P4. Отдельного SocialBid cooldown сейчас нет: `cooldownKey`/новую длительность не добавлять, общий minimum interval 30000 ms и ledger из §14 сохраняются; остальные применимые Activity cooldown не обходятся. Только stationary nonverbal вариант, без approach/LLM/нового kind/спрайта. Typed локальная пара `source: system` + `activityFamily: social_bid` зарезервирована за return; обычный Utility producer имеет `source: timer`. `reason` остаётся диагностикой. Existing Character gates разрешают этот системный play, но attention/friendship пороги выбора обычного Utility SocialBid не являются доказательством возвращения и не обязательны для return; общий intimacy/safety gate сохраняется.

Return не вызывает `onSocialBidStarted` → `AIEventRuntime.socialStarted`, не открывает AI-event/followup/memory episode. Общий Activity lifecycle/terminal/cooldown остаётся единым. Один token списывается только при фактическом start, отмена его не возвращает. Параллельные cursor/return opportunities сворачиваются в одну transaction; return рассматривается первым, два episode за один tick запрещены. Повтор observed active не повод для второго отклика; дальнейшие инициативы требуют своих независимых причин и обычного budget.

Quiet/menu/disable/reset/dispose и lifecycle из Perception теряют return, не создавая deferred greeting. Quiet/menu exit не переиспользует latch уже наблюдённого away; для нового return нужен новый непрерывный active→away episode. AFK invalidation не обнуляет существующие initiative ledger/cooldown. Обязательные fake-time сценарии: keyboard-only idle reset, threshold/hysteresis, startup с большим idle, zero/error/stale/out-of-order, gap/suspend/resume/clock jump, один return и busy drop, общий budget/cooldown, quiet/menu/critical/provider, late callback/reset/dispose, отсутствие AI-event на return.

### 13.2. Одна дополнительная попытка после молчания (SOC-A01)

**Архитектурное решение; implementation target отдельной задачи.** Первый slice невербальный: обычный local Utility SocialBid с `source: timer` может получить одну вторую попытку, затем Wisp занимается своими делами. Молчание не означает отказа, согласия, обиды или отсутствия человека. Provider/user инициативы, cursor episodes и system/P3 return (§13.1) не открывают эту цепочку; return не является ответом и не снимает её ограничение.

Transient session state принадлежит существующей Application/Main autonomy composition: `chainId`, lifecycle generation, actual runId первой/второй попытки, ordinal и terminal monotonic time. Чистая Domain policy решает переходы по явным времени, gates и RNG; Main передаёт факты, Activity остаётся единственным executor. Не нужны новый engine, IPC/wire поля, SQLite или очередь. Attempt variant передаётся внутренним typed значением, не строкой `reason`, не новым public BehaviorIntent/AnimationIntent kind.

| Событие | Переход и эффект |
|---|---|
| Первый local SocialBid реально started | Новая chain, attempt=1; silence latch закрывает обычный Utility SocialBid до нового принятого user input. Admission без start chain не создаёт. |
| Принятый direct chat либо реальный принятый pet/P1 input к Wisp | `answered`: закрыть chain/кандидат до async работы; снять silence latch. Будущий Utility выбор проходит обычные gates. Участие не доказывает удовольствия; второго reward нет. |
| Первый run completed без ответа | `unanswered`: T=terminal time; максимум один кандидат в окне ниже. Cancelled/failed run права на second не даёт. |
| Вторая попытка started | Attempt=2 с новым actual runId той же chain; duplicate started/terminal не создаёт attempt=3. |
| Вероятность не прошла, admission/start отказал, истёк deadline, второй run завершился | Закрыть кандидат; silence latch сохраняется. Последующий Utility SocialBid не становится скрытой третьей попыткой; остальные занятия продолжаются. |
| Отмена либо смена lifecycle/generation | `cancelled`: кандидат безвозвратно теряется; late callbacks проверяют identity/generation. Отмена сама не является user ответом. |

Accepted send учитывается при admission до recall/provider, включая будущий fallback/error; rejected/busy/duplicate send не считается контактом. Новый NLP-классификатор «стоп» не вводится: существующий явный user cancel отменяет pending, его принятый input учитывается как контакт. Cursor samples, keyboard activity вне Wisp, idle=`active`, return, provider reply и время не снимают silence latch. Это eligibility gate, без отрицательных learning/Needs/relationship effects.

Кандидат рассматривается на **первой оценке общего Brain tick/admission** с `T+30000 <= now < T+60000`: после обработки Activity terminal, до нового Utility выбора в той же transaction, как local P4 opportunity; отдельного scheduler/timer нет. Эта оценка не ждёт свободного runner: если он занят (включая calm), кандидат сразу теряется; terminal drain не запускает новый calm до этой проверки. При `now >= T+60000` он истёк, включая точную границу; resume/gap не создают catch-up. До окна RNG не читается. На этой одной opportunity после hard gates — один явный Domain draw `r∈[0,1)`: `r < 1/3` допускает second, равенство не проходит. Результат потребляется до start; ticks, budget expiry, failed start и duplicate terminal не дают повторного draw. Числа — стартовый tuning `SOC-A01-v1`, не измеренная оптимальная частота.

Second остаётся local P4 в существующей цепочке Character → admission → Activity. Он не прерывает **никакую** active Activity (включая calm), игру, Motion, provider/deferred owner, P0/P1/P2, user dialogue thinking/его speech guard или более приоритетную реакцию. Занятость на выбранной opportunity теряет кандидат, не откладывает текущую работу. Другие занятия могут выполняться во время ожидания; зарезервированного social slot нет. В одной transaction максимум один initiative start.

Second требует свежий Perception presence=`active`, последний authoritative sample со status=`available` и непрерывную текущую lifecycle generation; `inactive`, `unknown`, `probably_away`, unsupported/stale/zero/unconfirmed reading не доказывают доступности и теряют pending second. Baseline первого SocialBid/return не меняется. Quiet, [quietSupport](CHARACTER_ENGINE.md#61-тихая-поддержка-после-явной-реплики), menu, disable, sleep/critical, forced physics, lock/suspend/session loss и safety/privacy invalidation также теряют его сразу; снятие запрета кандидат не возвращает. Existing Character intimacy/safety gates сохраняются; thresholds сна/presence не копируются.

Перед выбором и непосредственно перед actual start повторить identity/generation, chain state, deadline, fresh presence, перечисленные gates, applicable Activity cooldown и **тот же** InitiativeBudget. Actual start расходует ещё один token и заново устанавливает общий minimum interval; бесплатного start/refill/резерва нет, отмена token не возвращает. Если другой episode получил приоритет, second пропускается. Preference/attention не компенсируют запрет. Нет обхода Character boundary отдельным executor или отдельного SocialBid cooldown.

Stationary second: existing `thinking_loop` + `expressionHint: curious`, `propHint: none`, bounded 1200 ms — как существующий [head_tilt](../../src/domain/behavior/cursor-observe-policy.ts); затем existing idle wait максимум 4000 ms. Вместо first `wave` — любопытный наклон; без approach, повторного wave, слов, talking и негативной эмоции. После wait обе local P4 попытки завершаются через [Activity §18.1](ACTIVITY_ENGINE.md#181-окончание-приглашения-без-ответа); T для follow-up — terminal после полного хвоста, а не конец wait. System/P3 return этим хвостом не расширяется. Semantic отличие проверяется автоматически; видимость наклона на текущем Skin/fallback требует отдельного native smoke. Архитектура её не подтверждает; новые ассеты/реплики не требуются.

Second **не** вызывает `onSocialBidStarted`/AI-event runtime, recall, provider, `previousInitiative`, memory/learning или dialogue history. First сохраняет existing opt-in event speech и прежние gates; дополнительных запросов нет. [AI Events §3](../../../docs/contracts/AI_EVENTS_CONTRACT.md#socialbid) описывает отдельную речь/контекст следующего пользовательского диалога, а не владельца second. Запрет повторной инициативной отправки в [Character §6](CHARACTER_ENGINE.md#6-авторский-профиль-wisp-revision-2-gate-122) относится к реплике; этот невербальный slice его не расширяет.

Reset/detach/replaceStream/Renderer reload, full memory reset, stop/dispose и Main restart теряют chain/run linkage; restore их не восстанавливает. В той же Main session silence latch сохраняется при quiet/menu/disable, reset/reload/stop и отмене до принятого input к Wisp; full memory reset/Main restart/dispose очищают его вместе с session state. После restart обычный baseline не воспроизводит старую second. Budget/cooldown сохраняют собственный lifecycle (§13), не сбрасываются ради функции.

Приёмка разработчика: unanswered/answered/cancelled, duplicate terminal, точные 30s/60s и `r=1/3`, один draw, budget exhaustion/новое окно/minimum interval, busy drop без preemption, fresh active против inactive/unknown/stale, quiet/support/sleep/privacy/AFK cancellation, input до async/позднего start, reset/reload/restore/dispose, отсутствие третьей попытки при бесконечных ticks, отдельный return, отсутствие новых AI calls/history/learning и semantic отличие жеста. Native smoke отдельно проверяет видимый curious head-tilt и возвращение к своим делам.

## 14. Обязательные инварианты и tuning автономности

Порядок источников, once-only, конечность deadlines/budget, отсутствие resume/очереди и единые owners
обязательны. Числа ниже — начальный **versioned tuning** автономности и инициативы; изменения требуют
детерминированных сценариев, но не нового public kind/threshold. Не заявляют OS smoke.

| Параметр | Начальное значение |
|---|---|
| `offerTtlMs` / `maxSafeDeferMs` / `maxProviderRunMs` | 30000 / 3000 / 20000 ms |
| Initiative window / max episodes / minimum interval | 120000 ms / 2 / 30000 ms |
| Cursor episode / суммарный approach distance | 6000 ms / 160 DIP |
| Social wait | 4000 ms |
| SOC-A01 second: delay / expiry от completed first / chance | 30000 / 60000 ms / 1⁄3 (один draw) |
| SOC-A01 second: curious gesture / wait max | 1200 / 4000 ms |
| Calm lifetime | 5000–11000 ms, существующая idle tuning range |

Все durations/distances конечны и положительны; counts — положительные целые; tuning version
обязательна в trace. Cursor freshness/dwell остаются Perception-owned, не копируются сюда.
Trace bounded (начально 64 decisions): gates, factors, winner, ownership, receipt, run result;
provider raw text, память, OS IDs и публичный debug IPC не добавляются.

Cursor-game-v1 расширяет fixed-target episode bounded retarget между legs по [Perception §6.1](PERCEPTION_ENGINE.md#61-cursor-game-v1-ограниченное-преследование); один run, общий initiative token и пределы из таблицы сохраняются. Движение cursor не создаёт новый episode, не продлевает deadline и не расходует новый token. При terminal без участия пользователя следующий unsolicited эпизод требует заново пройденного dwell после выхода/возврата курсора; stationary samples не создают серию игр. Общий cooldown/minimum interval также сохраняется.
