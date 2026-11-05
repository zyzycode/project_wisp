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
| P4 autonomous | Explore, Rest, calm, Zoomies, SocialBid, [book #183](ACTIVITY_ENGINE.md#20-body-i03-декоративное-занятие-с-книгой-183); target [manual window help #131](ACTIVITY_ENGINE.md#21-qa-soc-01-проверенная-просьба-перенести-на-окно-131) | Заменяет P5; local peers не заменяют active P4 по умолчанию. |
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


Для eligible семейства baseline `w0 = need × personality × repetition`; для ineligible `w0=0`. Факторы — конечные неотрицательные versioned функции Needs, Character traits/relationship и затухающей истории. Environment/quiet/cooldown служат gates. Вес не probability и не обрезается до1. CE-A01/#158 после Character causal slices заменяет общий выбор среди всех положительных весов: w=w0×preference×satiation×emotion, emotion=max(0.8,1−0.2×irritation) только для cursor_game/SocialBid; недоступные optional данные дают multiplier1, malformed required baseline исключает candidate. Оставить только w≥0.5×max(w), затем один явный RNG draw `[0,1)` по накопленным весам в прежнем стабильном порядке calm, Explore, Rest, play, SocialBid. Равенство cutoff включительно; на точной правой границе выигрывает предыдущее положительное ведро. Relative position calm bucket переиспользуется для pose без нового draw. Satiation/repetition и preference bounds — [Character §12](CHARACTER_ENGINE.md#12-ce-a01-причинная-жизнь-архитектурная-цель-153); no simultaneous old/new selector. Здесь P4 play — zoomies, не cursor_game. Реальный reactive cursor_interest сохраняет свой существующий single-candidate P3 путь: eligible game noticeChance умножается на1−0.75s перед прежним draw, без второго selector/cutoff для единственного кандидата; его Activity repetition=1. Ни zoomies, ни обычное cursor observation не получают game-only modifiers, priority/admission/cooldown не меняются.

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

## 15. CE-A01: одно долговременное приглашение (#159)

Это отдельный local P4 consumer существующей cadence, не provider safe-defer §12 и не interest-thread. Источник — acknowledged completed user_engaged cursor_game episode из [Memory §2, CE-A01](MEMORY_ENGINE.md#ce-a01-собственные-события-и-отложенное-приглашение). Только один current pending invite; при занятости слота новый source не ставится в очередь и не создаётся позднее от replay. Domain задаёт intent, Application управляет persistence и admission; [порт](../../src/application/ports/causal-life.interface.ts) не содержит SQL/timers. createdAt=source.occurredAt, notBefore=createdAt+5min, expiresAt=createdAt+24h; calendar deadlines UTC, monotonic используется только внутри текущего запуска. Future source/backward wall clock относительно persisted lastSeenWall → cancelled, истёкшее → expired; startup ждёт обычную fresh opportunity, не таймер даты и не catch-up.

На P4 opportunity сначала текущие eligibility/Needs/quiet/quietSupport/menu/sleep/P0–P3/presence/capability/общий InitiativeBudget и cooldown. Presence только fresh active из существующего sampler, отсутствие capability → omission; fallback по отсутствию мыши не выводит присутствие. После notBefore один кандидат приглашения, без вытеснения active peer run; busy пропускает opportunity, хранит pending до TTL. До start worker CAS pending→claimed с revalidation source/generation. Пока await, runner свободен для иных причин; после ack заново все gates и ownership. Claim ack потерян/late или gate изменился — start запрещён, terminal abandoned; request того же id не новый claim. Только ack текущего claim и сохранённая Application identity допускают один запуск существующего SocialBid/game invitation, обычный token лишь при фактическом start.

Pending переживает restart; claimed, чей исход не успел записаться, на startup атомарно становится abandoned и никогда не повторяется. Это at-most-once приглашение с возможной потерей в claim→start crash window, не exactly-once action. Terminal completed при реальном terminal приглашения; ignore не reward и не новый invite; refusal/user input/quiet/disable/reset отменяют pending/claimed, menu только pause без продления TTL; dispose не запускает continuation. Обычный shutdown сохраняет pending, claimed заканчивает cancelled/abandoned в существующем7s grace. Нельзя создавать источник из собственного приглашения. Storage failure не создаёт volatile копию durable promise и не блокирует локальный runtime; retry новых IDs/recovery replay нет. #162 проверяет source→claim→run→terminal и все lost-ack/reset/restart windows.

## 16. MIND-A01: объяснение прерывания, coping и восстановление (#163)

Это целевой договор #164–166 после CE-A01, не утверждение готовности runtime. Domain/Character владеет смыслом, reappraisal и deltas; Application связывает только проверенные источники и lifecycle; существующий worker хранит один source-linked record по [порту](../../src/application/ports/social-interpretation.interface.ts). Новых provider calls, произвольных beliefs, classifier намерений или параллельного executor нет. Интерпретация относится к одному cursor-game terminal, не ко всему пользователю и не к будущим событиям.

| Доказательство | Допустимый результат | Что остаётся неизвестным |
|---|---|---|
| Trusted user_interrupted после ≥1000ms | Факт прерывания; начальный статус unknown. | Мотив, случайность, враждебность. |
| Два таких terminal за60s | CE-A01 repetition/appraisal и resentment; каждый факт независим. | Повтор не доказывает намерение. |
| Явное собственное уточнение о последней игре | reported_accidental либо reported_deliberate с авторством user. | Высказывание не доказывает истинность объяснения. |
| Противоположное уточнение о том же событии | contradicted; оба source refs сохранены. | Нельзя выбирать удобную версию или усреднять в confidence. |
| Молчание, AFK, offline, чужая речь, model reply | Нет нового evidence. | Отказ, отношение, намерение. |

**Узкий ingress #164.** Без нового UI/NLP loop принимаются только самостоятельные точные RU/EN реплики после trim, Unicode case-fold и удаления одного конечного знака `.`, `!` или `?`: «я случайно прервал игру», «я случайно прервала игру», “i interrupted the game by accident”; противоположные — «я намеренно прервал игру», «я намеренно прервала игру», “i interrupted the game deliberately”. Цитаты, составные сообщения и прочие формулировки не классифицируются. Это явное атрибутированное сообщение, не apology detector. Exact recognized report ingress подавляет semantic model numerical effects через existing receipt.effectPolicy=suppressed независимо от успешности bind/записи; обычный base user-message effect, свободная provider reply и сохранение пары остаются прежними. Bind только к последнему acknowledged terminal user_interrupted текущего appRun, не старше5min, до первого последующего cursor-game start. Нельзя задним числом выбирать иной event. Source — committed accepted userMessageId обычного диалога, не assistant pair; generation/revision/source existence проверяются до commit. Неудачная запись/unknown source оставляет unknown; локальный runtime не ждёт её.

**Запись и пересмотр.** Один current record: episode exact ref, revision≥1, максимум2 distinct report refs; без исходного текста/произвольного confidence. Первый report меняет unknown; повтор того же source или того же report не повышает уверенность и не добавляет ref. Первый противоположный report делает contradicted; третий не вытесняет evidence. Новое acknowledged прерывание заменяет current record на unknown с новой identity; оно не наследует объяснение предыдущего. TTL24h от occurredAt исходного episode, UTC; expiry не продлевается report/read. Если wall clock раньше createdAt, запись omitted и очищается при ближайшем worker use case. Read/restart не создают событие или emotion.

**Consumer reappraisal.** При первом committed accidental report Domain один раз переоценивает ещё текущий affect того же causeSequence: intensity умножается на0.5, target/cause неизменны. Это пересмотр текущей эмоции, не rollback факта/relationship и не evidence невиновности. Deliberate/contradicted/unknown дают исходную CE-A01 appraisal без дополнительного усиления; если прежний affect ещё текущий, противоположный report восстанавливает не выше intensity, которую дал бы исходный event с уже прошедшим decay. Исправление/удаление report source и переход его record в unknown снимают только ранее применённый report factor у того же ещё текущего affect: восстанавливается исходная trajectory с уже произошедшим tick decay и прочими законными эффектами, включая completed coping relief; это не новый appraisal и не штраф за удаление. Decay clock/TTL не перезапускаются. Уже очищенный/истёкший/заменённый affect, reset/restart/dispose не допускают восстановления; отсутствие живой cause identity/метаданных даёт no-op. Хранится volatile исходная intensity+monotonic event time только текущего affect; repeated source не умножает её снова. Дальнейший tick использует ту же decay clock; новый event всегда оценивается заново. Director #161 получает только существующие intent/emotion/intensity/cause: belief refs и report text в wire не передаются.

**Coping #165.** На первом принятом user_interrupted с текущим irritated intensity≥0.2 создаётся одна volatile opportunity сроком30s от terminal. Стратегия pause при unknown/contradicted/deliberate либо relationship comfort<500; explore при reported_accidental и comfort≥500. Committed reappraisal может изменить стратегию до потребления, но не продлевает deadline. Pause даёт calm score×1.2, explore — wander score×1.2 перед CE-A01 cutoff в единственном Utility #158; прочие scores неизменны. Это склонность среди hard-eligible вариантов, не гарантированный action и не отдельный admission. Имеющийся peer run не прерывается. Opportunity потребляется первой свободной P4 оценкой независимо от winner; unavailable candidate/expiry даёт omission без retry. P0–P3, quiet/support, sleep/forced motion/user command/reset/dispose отменяют её; menu pause не продлевает TTL. Ignore/AI outage не эскалируют реакцию и не создают новую opportunity.

Calm/Explore исполняются прежним Runner, с его deadline и outcome. Только completed run, реально выбранный с этим coping factor, дополнительно умножает всё ещё текущий affect того же source на0.5 один раз; иных Needs/relationship/learning rewards нет, обычный Explore effect сохраняется. Rejected/not_started/cancelled не дают облегчения. Terminal связывается с actual runId/generation; source сменился/истёк, duplicate/stale callback → no effect. Возврат — обычный следующий выбор; новых реплик, обещаний, обязательного ухода от пользователя или отдельного provider cycle нет.

**Repair #166.** Time decay меняет только affect. После durable user_interrupted с resentment>0 следующие новые acknowledged completed user_engaged игры после≥1000ms могут дать trust+1 и resentment−1 дополнительно к CE-A01 completed deltas, только пока последнее прерывание не старше24h. Неизвестность/случайность объяснения не отменяет проверку фактического положительного опыта. Один source — максимум один repair, минимум5min между repair effects и не раньше5min после последнего прерывания; clamp facets0..1000. Supportive chat сохраняет свои CE-A01 deltas, но не считается игровым repair. За сам факт apology/report нет отдельной relationship delta или сброса истории; exact reports следуют suppression ingress выше, остальные сообщения сохраняют обычную [Character §9.2](CHARACTER_ENGINE.md) appraisal с прежними gates, без нового generic apology detector. Affection/love/consent/axes не меняются. Ни время, ни отсутствие пользователя не создают repair/penalty.

Repair использует общий30s semantic gate CE-A01; completed deltas+repair+markers меняются одной Character transaction. Уточнение observed/ack границы #156: только completed, уже eligible для repair по текущему proof/resentment/5min/24h, вместо немедленной facet mutation резервирует этот gate от original observed monotonic time и один volatile slot максимум200ms. Affect, Needs, familiarity/play reward и ввод не ждут SQLite. Успешный ack того же exact source/current appRun/generation строго до deadline применяет суммарные deltas; fail/timeout/отсутствие storage завершают slot обычными completed deltas один раз, без repair. Остальные completed сохраняют немедленный CE-A01 путь. Ack не открывает gate заново; занятый gate не даёт reservation/repair. Новое прерывание/source invalidation немедленно завершает slot base-only независимо от целости conflict source. Reload/dispose/shutdown того же Character profile также синхронно завершают base-only до финального checkpoint и удаления callbacks; смена memory generation не отменяет этот observed base. Только full reset/replacement старого Character profile отбрасывает slot без оплаты. Поздний ack/повтор/старое поколение ничего не доплачивают. Application владеет injected monotonic deadline/timer, Domain — проверками/атомарной mutation; input/tick не await-ят storage, очереди pending repairs нет.

Checkpoint V4 после V3 хранит [RelationshipRepairCheckpoint](../../src/application/ports/relationship-repair.interface.ts): пары UTC+exact ref последнего acknowledged user_interrupted≥1000ms и последнего оплаченного completed repair. lastInterruptionAt равен source occurredAt; lastRepairAt — UTC фактической успешной atomic mutation при ack, не terminal occurredAt completed source: ref задаёт identity, а timestamp отсчитывает5min между effects, включая restart и задержку ack≤200ms. V1–V3 получают null pairs без replay; writer/restore/validators вводятся вместе. Если V5 #170 уже введён, #166 сохраняет V5 и нейтральные repair defaults, без downgrade. Последний observed interruption немедленно запрещает repair по предыдущему proof; только ack именно этого последнего source снимает запрет. Acknowledgement не создаёт повторных interruption facets/affect. До reservation и при ack проверяются текущие resentment>0, тот же interruption proof и отсутствие source mutation; случайность/unknown report не заменяет proof.

Interruption proof — exact acknowledged episode с совпадающими ref/UTC/cause/executedMs, а не наличие social singleton или timestamp отдельно. Startup и source mutation валидируют один ref через existing causal resolveSources в общем параллельном200ms memory budget; pending append/source barrier завершается в том же deadline, без дополнительного окна. До результата proof отсутствует; missing/invalid/timeout/storage failure дают omission, без history scan/SQL на tick. Destructive source mutation/generation инвалидируют RAM proof синхронно до SQL; поздний read его не публикует. Обычный append другого episode не снимает уже проверенный interruption proof. Read/restore не меняют markers/facets и не являются experience. Новые acknowledged interruptions текущего appRun обновляют checkpoint/proof один раз, старые callbacks не заменяют более новый source.

При валидном wall clock restart переводит оставшиеся части обоих5min окон в monotonic deadlines; elapsed offline time само не даёт эффекта. Wall time назад/future marker/невалидный monotonic interval → repair omitted до свежего acknowledged interruption. Этот новый interruption начинает новое полное5min окно и очищает недостоверную future repair pair, сохраняя facets; current-run high-water остаётся защитой повтора. RAM high-water текущего appRun и accepted durable sequence защищают callback repeat; old appRun/restore/read не подаются как новые experiences. Потерянный checkpoint может потерять последнюю mutation, но не разрешает replay старого источника.

**Memory lifecycle.** Interpretation singleton — следующая additive migration существующего worker после #154; replace/clear CAS, source validation и mutation одним SQL transaction; CAS conflict требует перечитывания, не blind retry. Retention record до TTL/source invalidation/replace/full reset; immutable event и обычные messages сохраняют собственный retention. Source correction/deletion, generation change, reset/reload/dispose синхронно снимают RAM interpretation/coping до barrier; worker той же transaction очищает зависимый singleton. При удалении одного report весь record становится unknown, не выводится снова из оставшегося текста без нового user input. При unavailable read — omission, не подтверждённый unknown record. Rollback/lost ack не возвращает старые callbacks; write retry только same identity/payload.

Уже применённые исторические relationship deltas не пересчитываются по удалённому тексту/исправленному объяснению: это intrinsic динамическое состояние, не пересказ/доказательство источника. Source-linked explanation и возможность нового repair снимаются немедленно; full reset очищает и facets/markers по существующему контракту. Ни repair, ни deletion не replay-ят всю историю. Startup revalidates singleton источники exact indexed reads≤3 в общем200ms memory budget до публикации; timeout/storage failure → omission. Restore affect/coping не восстанавливает; сохранённое объяснение не возрождает эмоцию.

Проверяемые исходы: repeated delivery/read/restart — без усиления; same history+accidental report — меньше только ещё текущая irritation; contradicted — unknown motives и исходный bounded decay; одинаковый decay без нового опыта — trust неизменен; новые игры после5min — bounded repair; sleep/quiet/input/rejected coping — без relief; delete/reset/late ack — без старой projection/повторного effect; storage failure — текущая локальная жизнь продолжается. Статус знания, coping и repair не утверждают психологическое состояние человека.

## 17. MIND-A02: собственная цель, короткий план и привычный переход (#167)

Целевая эволюция #168–170 после CE-A01, без нового BDI/GOAP engine. Domain/Character владеет двумя мотивами и bounded factors, Application передаёт предложения одному Utility/admission/Runner; existing Memory worker хранит один CAS singleton по [motivation.interface.ts](../../src/application/ports/motivation.interface.ts). Goal — причина выбора, plan — не более трёх разных semantic runs, Activity phase — шаг внутри одного run; deferred invite §15 — отдельное обязательство с отдельным source/TTL. Они не становятся единой очередью.

| Механизм | Возникновение | Фактический успех / конец | Предел |
|---|---|---|---|
| recover_energy | energy<40 при armed и fresh local tick | Completed rest либо energy≥60; не утверждает полного восстановления. | Один goal этого kind, TTL10min. |
| seek_novelty | boredom≥60 и energy≥30 при armed | Completed Explore; с #169 — полный конечный plan ниже. | Один goal этого kind, TTL10min. |
| План seek_novelty | Актуальный goal и свободный executor | Rest (только если energy<45) → Explore → calm/look_around, каждый actual completed. | ≤3 runs и actual starts, по одному на шаг; failed шаг не повторяется. |
| Own habit | Подтверждённые Explore→следующий Activity переходы | Небольшой фактор только после нового Explore. | Один cue/action, последние20 transition samples. |
| Deferred invitation | Durable completed game source | Existing invite terminal/expiry. | Один slot; не шаг own plan. |

**Goals #168.** Оба slots могут сосуществовать, новый tick того же дефицита не создаёт goal. При создании kind latch разоружается; rearm только на fresh tick при energy≥60 для recovery или boredom<40 для novelty. Начальный startup/reset latch=true, но evaluation ждёт обычной свежей возможности, не replay истории. Terminal goal row заменяется следующим goal того же kind только после rearm; максимум2 current goals, не журнал. Goal IDs Main-generated opaque≤128, immutable kind/createdAt/expiresAt; now/UTC validation по Memory. Input вне finite Needs даёт omission, не default желание. Candidate goals не делают effects и не вызывают AI.

При двух pending goals recover_energy имеет приоритет, пока energy<45; иначе seek_novelty. Первый goal даёт existing rest-family score×1.2; второй — Explore×1.2. До #169 novelty success по completed Explore; после подключения #169 success только по plan terminal. Goal influence перед cutoff единственного selector #158, только на eligible candidate; без прямого start или второй RNG. Если matching candidate не eligible, factor omitted, другие занятия допустимы. User command/P0–P3/safety сильнее goal: они не ждут plan. Sleep/quiet/menu временно снимают factor без продления TTL, forced loss не сохраняет route. Explicit user cancel/disable/full reset отменяют goals; quiet не наказывается.

Actual matching started run связывается с goal id/generation и одним step token; только соответствующий terminal completed может дать success. Preview/admitted/not_started не success; cancelled/failed не дают goal reward и завершают связанную попытку как cancelled. Успех не даёт дополнительных Needs/отношений/learning effects поверх Activity. Completed rest может закрыть recovery, даже если тот же run был первым шагом novelty plan; это один execution effect, не две оплаты. Deadline на точной границе now≥expiresAt → expired раньше start/completion.

**Один plan #169.** Создаётся только для pending seek_novelty; recovery остаётся самостоятельным мотивом/фактором, не вторым plan. Шаблон вычисляется из fresh Needs при первой P4 opportunity: optional rest при energy<45, затем Explore и calm/look_around; не менять порядок ради выгоды. План не резервирует executor между runs. Его next-step factor заменяет goal factor того же candidate, не перемножается. Final step calm_look_around означает конкретный semantic pose: eligible calm-family получает plan factor×1.2; если family выиграл единственный existing draw, resulting calmPose детерминированно look_around, без второго draw/дополнительного pose multiplier. Это допустимо только при hard-eligible доступном look_around с положительным existing pose weight; иначе plan factor/claim omitted, ordinary варианты разрешены. После claim ack те же gates перепроверяются; другой calm pose не matching step и не success. Habit #170 остаётся лишь вероятностным pose-weight bias, не таким plan constraint. Другой Utility winner может исполниться; перед следующей opportunity заново gates/Need/capability/deadline. Потребности/own interest/satiation продолжают влиять через существующие scores, план не убирает низкополезные варианты из cutoff.

При energy<30 до Explore/calm plan уступает recovery/critical sleep и остаётся pending до TTL; при boredom<40 до actual Explore goal cancelled как потерявший актуальность, без притворного выполнения remaining steps. Если Explore уже completed, final calm ещё должен реально завершиться; energy<30 также откладывает его. Невозможная Explore capability/unreachable target после admitted attempt, failed/cancelled step, user command, explicit cancel/disable/forced loss завершают plan cancelled; невозможность на eligibility до admission даёт omission до TTL, без polling/retry queue. Между runs нет старого target/motion route. Нет отката выполненных effects.

Перед matching start worker CAS записывает claim(stepToken,appRunId), затем после ack повторные gates и одно offer существующему admission. Actual runId привязывается к текущему token, не создаёт второй claim/start. Lost/late claim ack запрещает dispatch; not_started/changed gate после ack завершает goal abandoned/cancelled, а не откладывает claim снова. Duplicate terminal требует той же token/run identity и не продвигает step повторно. Максимум3 actual starts, по одному на step; failed start не повторяется. Пока await claim, executor свободен другим owners; если opportunity потеряна, claim abandoned. At-most-once start с допустимой потерей claim→start при crash; exactly-once execution не обещается.

**Restart/persistence.** Following additive migration хранит один motivation row: goals≤2, plan≤1/steps≤3, revision, latches и lastSeenWall; CAS claims/terminal/replace atomic, без новой таблицы очереди/журнала. Claimed plan на startup atomically abandoned, старый Motion/run не восстанавливается. Unclaimed pending goal может пережить restart только после fresh gates; plan сбрасывается и строится заново из нового state, сохраняя TTL и использованный start count, не старый шаг/маршрут. Clock backward относительно lastSeenWall, future/invalid dates или expired goal → cancel/omission; нет offline catch-up/decay/потока пропущенных действий. Missing/unavailable storage отключает новые durable goals/plans без volatile обещания, базовый Utility работает offline. Lost write ack не означает сохранение; retry только same CAS identity/payload. Reset/mutation/dispose отменяют in-flight до barrier, full reset очищает singleton одной worker transaction; rollback не возвращает callbacks.

**Habit #170.** Единственный cue — actual completed Explore любого инициатора (local/user/provider), не proposal или текст: собственный опыт означает реальное исполнение, а не источник команды. Action — следующий actual completed calm с pose look_around в той же appRun не позднее60s, без intervening started run. Иное следующее completed занятие даёт sample other; cancelled/failed, admission/rejected/preview не обучают и закрывают текущий cue. По одному sample на distinct exploreRunId, общий learning gate5min с startup/reset задержкой; следующий start не переоткрывает уже потреблённый cue. User input/P0–P3/quiet/sleep/forced/lifecycle interruption снимают volatile cue; completed Explore после прежнего ввода может создать новый cue, следующий user command снова его снимает. Отсутствие действия/пользователя не negative sample. Один terminal может дать существующий adaptation и habit update разным consumers, но не дублировать ни один из них.

Checkpoint хранит последние20 уникальных factual transitions с обеими run identities, nextKind и UTC, без пользовательского текста/распорядка; eldest eviction после append. N=count≤20, P=count(calm_look_around); при N≥6 multiplier=1+0.1×P/N, иначе1. Только при fresh transient Explore cue этот factor применяется к calm/look_around: вне cue нейтрально. Не повышать весь calm family из-за единственной pose; factor участвует в выборе pose через те же существующие weights/тот же draw, не дополнительный RNG. Combined user/own preference cap0.8..1.2 CE-A01 сохраняется как независимый baseline. Для последующих modifiers G=goal-or-plan≤1.2 (не их произведение), C=coping≤1.2, H=habit≤1.1; отсутствующий factor=1. Family score сохраняет G×C, только look_around pose weight получает H_effective=min(H,1.5/(G×C)), так что G×C×H_effective≤1.5 без дополнительного family boost. Exact plan look_around обходит habit pose bias. Ни один factor не меняет hard eligibility/budget/consent/cooldown, низкий baseline не получает обязательного выбора.

Habit — intrinsic bounded learned state, не гипотеза о пользователе и не reflection из текста. SnapshotVersion5 включает прежние V3 facets/interest refs, V4 repair markers и ownHabitMemory; V1–V4 мигрируют без replay с отсутствующим habit=[]/lastLearnedAt=null и repair=null, если их ещё не было. Writer/restore/validators поставляются вместе; если #166 ещё не rollout, V5 уже содержит нейтральные repair defaults, последующее #166 сохраняет V5 вместо downgrade. Restore переносит samples, но cue и sequence high-water не восстанавливает, gate ждёт полные5min. Повтор source/старый appRun/recall/summary/AI reply не sample. Atomic checkpoint может потерять последний sample при crash, но не воспроизводит его как новый. Full reset очищает learned state; если появится отдельное удаление Activity evidence, оно в той же mutation удаляет соответствующие transition refs и пересчитывает bounded N/P, без full history scan.

Матрица разработчика: identical seeds/history повторяют goal/plan/choice; разные Need/transition histories дают объяснимые различия; sustained deficit не плодит goals; threshold/TTL exact boundaries и rearm; rejection/duplicate/lost ack/claim→start crash; fresh restart с unclaimed goal и abandoned claimed step; quiet/sleep/user/forced preemption; storage outage/reset/late callbacks; paired habit histories с одинаковыми tastes/Needs и нейтральность вне cue. Не заявлять новое занятие, человеческое сознание, visual/native качество или завершение #196/#197 по этим mocks.

## 18. WORLD-A01: текущая возможность и осторожный распорядок (#187)

Target slices #188/#189 переиспользуют существующие источники, не обещают чтения мыслей/занятости. [Perception §7.1/11](PERCEPTION_ENGINE.md#11-наблюдение-за-активным-приложением-active-application--window-title) владеет сенсорами/согласием/freshness; Application нормализует, Domain получает только [CurrentComputerContext](../../src/application/ports/world-context.interface.ts), существующие Needs/gates и bounded hypothesis. Raw appName/title/path/native metadata не входят в Domain. Новых pollers/sensors/permission prompts/dependencies нет; оба consumers optional и не останавливают offline FSM/Motion/input.

| Наблюдение | Разрешённый смысл | Неизвестное |
|---|---|---|
| Fresh positive idle sample | active/inactive/probably_away по прежнему AFK tuning. | Физическое присутствие, внимание к Wisp, продуктивность. |
| Разрешённый foreground episode сменился | Наблюдалось переключение; краткое settling окно. | Работает/играет/занят/готов говорить. |
| Title/app category/editor metadata | Только прежняя отдельная observation реакция; не новый behavioral evidence. | Интерес, профессия, эмоция, цель пользователя. |
| Условно повторяющиеся active intervals | Tentative повторение при работающей Wisp в том же cohort. | Истинный полный распорядок/будущая доступность. |
| Нет coverage, источник unknown/offline, закрытая Wisp | Нет доказательства. | Отсутствие, отказ, изменение привычки. |

**Текущий context #188.** Отдельный session opt-in «Учитывать переключение окон при выборе момента приглашения» off по умолчанию, внутри существующих настроек наблюдения. Он не запускает helper и не заменяет сетевое согласие §11: нужны active current consent/allowlist, доступный backend/provider и свежий разрешённый observer sample. Existing network observation/AI-reaction остаются теми же, новых calls нет. До включения прямо указать: используются только уже разрешённые наблюдения, факт переключения помогает кратко отложить приглашение; это не распознавание занятости. Без этих условий foreground=unknown и прежние local/AFK gates, не скрытый local-only app observer.

Application сравнивает только opaque appKey+foreground episode при той же policy generation; title/sourceToken change сам по себе не переключение и не продлевает settling. Новый episode/первый fresh sample начинает3s непрерывной stable-observation history; до now−firstSampleAt≥3000 foreground=settling, после stable. TTL2500ms и gap1500ms по Perception§11; invalid/out-of-order/negative clock/gap сбрасывают историю в unknown, новый sample начинает заново. Context generation меняется при consent/policy/stream/source/lifecycle invalidation, sampledAt не обновляется cache read. Presence берётся из единственного существующего idle sampler с его собственной TTL/continuity, без чтения raw idle или нового таймера.

Единственный новый consumer — opportunity одного pending deferred game invite #159. Fresh settling временно закрывает admission/claim, сохраняя pending до прежнего TTL; fresh stable нейтрален, не положительное разрешение. Unknown не добавляет запрет и не отменяет existing requirement fresh active presence из #159. Поэтому отсутствие app observation не выдаёт knowledge, но не лишает локальный baseline допустимых действий. Source/context rechecked перед claim и после ack до start; если context generation изменился после claim, start запрещён и claim abandoned, без replay. Сам sample не start/reward/budget event. После3s рассматривается лишь очередная existing P4 opportunity: нет нового timer, catch-up, гарантии разговора или budget bypass.

Off/revoke/pause/backend loss/policy change/reset/reload/lock/suspend/helper failure синхронно снимают context/settling и pending capture; original observation lifecycle остаётся сильнее local consumer. Restart очищает local timing opt-in вместе с original RAM policy; resume после lock/failure только existing explicit resume и новые fresh samples. Quiet/menu/sleep/P0–P3/user command/#159 expiry/cancel сохраняют свои правила; stale callback не возвращает context или старый invite. Status в existing observation settings — off/settling/stable/unavailable, без metadata вне прежнего explicit preview.

**Routine #189.** Capture/retention остаются [Memory§16](MEMORY_ENGINE.md#16-локальные-наблюдения-распорядка-127), выбор алгоритма совпадает с принятым #127: только текущий шестичасовой local window и28 завершённых local dates текущего cohort, текущий неполный день исключён. Eligible date имеет≥4h classified coverage, positive date≥1h active; N≥14, P/N≥0.7 и≥5 positives среди последних7 eligible, последний eligible≤7 calendar days. Это эвристика условной повторяемости, не calibrated probability; idle0/unknown/gaps/offline не дополняют coverage. Inactive/away — наблюдаемые классификации, не доказательство причин отсутствия. Суммировать только aggregate rows, чьи shifted local [start,end) целиком внутри выбранного6h window; end ровно на границе допустим. Пересекающий границу aggregate целиком omitted для обоих windows: class durations не локализованы, prorata/midpoint allocation запрещены. Missing dates/gaps/omitted rows уменьшают покрытие и делают дату ineligible, не whole-query error:14 подходящих дат из28 могут пройти при14 uncovered.

Read по index(cohortId,localDate) для28 dates и максимум один indexed predecessor перед нижней границей для известного offset boundary; predecessor также входит в общий LIMIT10001/10000 examined rows,4MiB/200ms, не дополнительный budget. Отсутствие predecessor не штраф/ошибка и не доказательство перехода. Более10000 examined rows, >4MiB internal serialized rows, invalid/overlap/ambiguous/future input или общий recall deadline200ms → whole hypothesis omission, не расчёт по усечённому prefix. Никаких SQL reads на Brain tick. Один read group существующего LocalMemoryRecall на ordinary user turn, не фоновая генерация; aggregate pure Domain, допускается выполнение этой pure функции в существующем worker для bounded result≤8KiB, без нового semantic owner. Fresh datasetEpoch/cohort, текущие zoneId/offset/tuning и source existence сверяются до/после read и перед отправкой; разные historical offsets сами по себе не malformed row/whole-query ambiguity. Повтор read не learning. Source-of-truth — immutable routine rows; hypothesis RAM derived cache, не новый факт/Character interest/lore.

IANA zone/backward clock/wall-monotonic discontinuity используют новый cohort по capture. Offset/DST сам по себе cohort НЕ ротирует: #128 capture остаётся прежним. #189 сравнивает только текущий persisted cohort/zone и даты с одним observed offset, равным текущему offset. Mixed-offset local date целиком ineligible; при различии offset двух соседних observed rows исключить обе endpoint local dates и даты между ними (момент перехода в gap неизвестен). Different-offset dates ineligible, не переносятся/не складываются с current-offset датами; остальные сопоставимые даты того же cohort допускаются. Ни virtual cohort, ни IANA transition inference/calendar engine, ни перегруппировки старых rows; unseen history не доказывает DST. Недостаточное N/P/recent7 даёт omission, а сами корректные пропуски не whole-query error. Cached hypothesis действует только до следующей local date/смены шестичасового окна/current offset, cohort/dataset/source mutation или expiry последнего eligible date; любой такой invalidation требует свежего bounded read следующего обычного turn. Новые противоречащие завершённые сутки могут снизить P/N/last7 ниже порога — omission сразу после recompute, без self-confirmation из текста ответа.

**Передача/управление.** Отдельный session opt-in в existing Memory overview «Передавать гипотезу распорядка в обычный AI-диалог», off при startup/restart/reload/lock/suspend, не включает app observation. До включения показывать scope «только при работающей Wisp», текущий6h window, counts N/P/recent7 и observedThroughDate; отсутствие достаточных данных/нет сети понятно обозначается. Отказ не меняет локальный capture/history. Preview/отключение не отправляют запрос; следующий обычный send при active consent может добавить одну [wire hypothesis](../../../docs/contracts/BACKEND_MEMORY_CONTRACT.md#12-world-a01-условная-гипотеза-распорядка-187), без raw diary/заголовков/timezone IDs и новых calls. Consent на routine sharing не разрешает app metadata, screen, tools или инициативные вопросы.

«Не использовать этот вывод» отзывает current window hypothesis и запоминает suppression этого из4 windows до явного «Разрешить снова»/full reset. Flags глобальны внутри локального профиля, не сбрасываются cohort/timezone/restart; максимум4 booleans в existing worker следующей additive migration, без текста/нового user fact. Withdrawal synchronously инвалидирует active request/capture/context/late reply до SQL barrier; read/suppress/source validation атомарны с существующей generation policy. Потерянный write ack не подтверждение, no blind retry/new identity; безопасная RAM блокировка остаётся до успешного reread, rollback не оживляет старые результаты. Re-enable sharing не снимает suppression. Full reset одной transaction удаляет flags/derived cache/raw observations; автоматический capture после reset пишет лишь новые samples. «Удалить настройки наблюдения» касается app policy и local timing, не скрыто стирает routine history.

Projection обычного dialogue — не source для memory extraction/summary/facts/других hypotheses. Любой turn, реально получивший routine block, связывается trusted локальной association с user/assistant pair и suppress-ится для derivative summary/recent recall аналогично existing beverage/topic use; это исключение assistant paraphrase, не новое evidence из текста. Разрешённый recognizer явных facts из текущей user-реплики сохраняет прежнюю policy; сгенерированный routine текст не evidence. Source invalidation/withdrawal очищает pending/cached projection и не позволяет восстановить старый вывод через summary/history/replay; raw source retention неизменён. Backend/provider уже полученные данные не объявляются удалёнными local command; server storage не добавляется. Согласие/app policy и hypothesis не попадают в private-content diagnostics.

Матрица #188/#189: paired settling/stable/unknown intent opportunity; same/stale/out-of-order samples и3s boundary; opt-in/revoke/backend outage/unsupported/restart/lock/suspend; source→claim→actual invite terminal без duplicate. Для routine:14/28day thresholds,70%/last7 boundaries, holes/zero/unknown/DST/cohort changes/10001-row omission, source delete/reset/withdraw/re-enable и late callbacks; synthetic balanced/stable/changing schedules, ordinary dialogue only и TS/Python fixtures/atomic drop/auth/timeout/cancel/malformed. Native app observer/system-idle support и выразительность живого диалога отдельно NOT RUN, если не проверены на целевой ОС.

## 19. MEMORY-A04: собственный интерес к музыкальным темам (#178)

Первый music domain — интерес к текстовому обсуждению, не услышанная музыка/сенсорное удовольствие, знание жанра или authored хобби. Domain/Character владеет intention и числовым reducer; Application — admission/current sources; существующий SQLite worker — атомарностью/retention. Формы — [music-interest.interface.ts](../../src/application/ports/music-interest.interface.ts); wire — [Backend Memory §14](../../../docs/contracts/BACKEND_MEMORY_CONTRACT.md#14-memory-a04-музыкальная-тема-178). Generic ontology, audio/network sources, autoplay и самостоятельная topic initiation не вводятся.

Закрытые ids jazz/classical/rock/electronic имеют ровно RU/EN labels `джаз/jazz`, `классика/classical music`, `рок/rock`, `электронная музыка/electronic music`; RU предложные формы — `джазе/классике/роке/электронной музыке`. Нормализация: NFC, trim, lowercase, удалить один конечный `.`, `!` или `?`; иные punctuation/quotes/multiple topics/aliases — no-match. Максимум recognizer240 UTF-16 units. Только полная фраза `давай поговорим о <RU предложная форма>` / `let's discuss <EN label>` открывает discussion; `продолжим разговор о <RU предложная форма>` / `let's keep discussing <EN label>` — continuation. Прочий текст остаётся обычным chat, но не этим evidence; assignment «ты любишь…», роль, цитата, recall/summary/model output не проходят recognizer.

В принятом ordinary opening Domain может до единственного provider dispatch выбрать intention ask_music_detail: один injected RNG draw<0.25, только awake, без quiet/support, активного локального role-mode, causal Director override #161 и другого topic/hypothesis bundle; повтор request не новый draw. При false обычный ответ сохраняется, sample невозможен. Intention — возможность уточнить текущую тему, не новый верхнеуровневый Director: любой #161 causal intent сильнее и отменяет её. При нехватке budget/отсутствии provider capability намерение omitted; без фактически отправленного music block нет intention execution. Фактическая отправка — desktop wire dispatch; backend prompt inclusion unknown, отдельного receipt нет и отсутствие backend question не опровергает local intention. Числа интереса/отношений не влияют на этот draw, без reinforcement loop. RoleActive означает только authoritative locally admitted Application mode; его отсутствие в текущем product даёт false, injected true тестирует gate. Raw history/user role command/model wording не объявляют mode и не анализируются новым NLP: сами role/quote/composite реплики не exact opening/continuation и не sample, а последующий самостоятельный approved dialogue подтверждает только Domain intention, не роль.

Application держит один volatile receipt принятой intention: request/current generation/conversation/topic. Только successful current nonfallback response, реально опубликованная и сохранённая memory_confirmable adjacent user+assistant pair открывают один слот continuation на5min от opening admission. Это факт принятого разговорного намерения, не доказательство, что provider действительно задал вопрос. Следующий user send потребляет слот независимо от текста; sample допустим лишь при exact same-topic continuation той же conversation, тоже с successful published persisted pair, до deadline. Между ними не может быть другого user turn; две пары/четыре distinct source IDs обязательны. Нет ответа/timeout/rejected/stale/provider failure/cancel →0; late opening не создаёт слот после следующего ввода. Reset/reload/dispose/новая conversation/source mutation снимают receipt; pending намерения не восстанавливаются.

Второй subject user принимает только полную фразу `мне нравится <RU label>` / `мне не нравится <RU label>` / `i like <EN label>` / `i dislike <EN label>` из successful persisted current ordinary user pair. Максимум4 records по topic; новое явное значение заменяет value/source, не повышает confidence и не обучает Character. Исправление/удаление источника даёт unknown, не возвращает старое значение; несовпадение вкусов не меняет отношения/consent. User source не continuation и не самостоятельное evidence интереса Wisp. В context выбирается один самый свежий valid user record по occurredAt, при равенстве topic ASCII ascending; его topic может отличаться от текущей music темы.

Один новый sample максимум на topic/UTC date и на opening/continuation pair; общий music gate5min monotonic, startup/reset ждёт полные5min, без catch-up. Gate потребляется при принятии попытки append, fail не возвращает allowance; pending append максимум один. Failed/unacknowledged write не публикует sample и не открывает новый слот. Retain максимум12 samples/topic,48 total; каждый живёт30×24h от continuation occurredAt, без продления на read. При новом допустимом дне cap вытесняет самый старый sample; порядок UTC затем exact opening user ID. UTC назад/future source/отрицательный interval → omission, не negative experience. User records также TTL30days от собственного source. Unknown keys/свободных aliases/копий текстов в records нет.

Music tracks `own.music_topic.<id>` начинаются unknown; по n ещё валидным samples Domain вычисляет value=2n (0..24), samples=n (0..12), confidence=n/(n+6). n<6 не проявляется как собственный интерес;6..11 emerging,12 established. Это положительный discussion interest, не dislike или любимый жанр; просьба прекратить обсуждение немедленно соблюдается, но не выдаёт настроение пользователя за отрицательный собственный опыт. Числа не меняют axes/Needs/relationships и не используют activity rewards/gates. Единственный consumer — context текущего ordinary dialogue с exact распознанной music темой; никаких фоновых реплик/behavior multipliers/других domains.

Источник истины — bounded samples/user records в additive tables существующего worker, не generic facts/beverage и не новый storage subsystem. Одна transaction validate-source+append/replace+cap/TTL: pairs существуют, adjacent roles/current source revision1/memory_confirmable, texts совпадают с finite recognizer и одним topic; unique opening/continuation предотвращают повтор после restart. Trusted Application receipt доказывает pre-provider intention/фактический dispatch/publication; SQL не выводит их из assistant text. До ack numeric cache не публикуется. Character checkpoint может сохранить cache четырёх music tracks в existing preferences; startup очищает cache до валидации таблиц, source rows пересчитывают его без learning/replay. Snapshot version не повышается, V4/V5 других slices не меняются.

Каждый read worker source-validates/TTL-prunes максимум48 samples+4 preferences indexed joins, без transcript scan; source delete/correction в той же transaction удаляет зависимые sample/record и bounded пересчёт меняет cache, без rollback иных facets. Application синхронно снимает music projection/cache/receipt перед mutation/reset; generation/epoch отсекают поздний callback. Startup/source mutation/context capture имеют existing общий200ms budget с memory operations, не новый последовательный таймаут; timeout/unavailable/invalid → music omitted, local life продолжается. Read/restore не создают samples. Full reset удаляет tables/cache; generic history retention прежний. Projection не содержит source refs/dates/текстов/numeric counts или утверждений «слышала/люблю».

Все пары с фактически dispatched music intention/projection получают trusted derived-use suppression для будущих raw recall/summary, аналогично topic/beverage; иначе assistant paraphrase пережила бы source deletion. Suppression не отменяет finite recognizer текущего user statement, но не позволяет считать assistant output/recall новым sample. Проверки #179: paired histories при одинаковом RNG, user taste отдельно, no own intent/model-only/quotes/roles/alias conflict, duplicate/source cap/TTL/5min/day, publication/write failure, reset/restart/delete/correction/late callbacks, #161 override, ordinary-only TS/Python guards и no-audio wording; живая выразительность отдельно human acceptance, без блокировки технического slice.
