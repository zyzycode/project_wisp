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

Только normalized Character Needs/tone/personality/relationship/intimacy, готовые quiet/sleep gates, Activity rank/cooldown/repetition, [Perception geometry/signals](PERCEPTION_ENGINE.md), candidate `source`/`priority`/`requestId` и catalog identity.

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

```text
U(c) = clamp(
  base(c)
  × need(c)
  × tone(c)
  × personality(c)
  × environment(c)
  × repetition(c),
  0,
  1
)
```

Versioned factors потребляют Character semantics и Activity history, не переопределяют их. Positive factor меняет utility, не hard gates/P0–P3.

Из eligible P4 выбрать max bounded U в stable catalog order, tie → первый. Пустой set → safe `idle` через обычный Character gate. Результат — максимум один resolved intent. P0–P3 не участвуют в score; P5 не P4 fallback, запускается лишь после общего safety order.

## 8. Детерминизм

Одинаковые snapshot/ordered candidates/history/tuning/decisionSequence → одинаковые eligibility/scores/winner. Policy immutable, не планирует переоценку. Будущая вариативность только explicit seeded PRNG с seed в fixture/trace; wall-clock seed/provider randomness запрещены.

Application исполняет одну decision transaction одновременно; новые inputs идут в следующий sequence. Resolved intent публикуется после полной transaction, без промежуточных candidates для Brain selection.

## 9. Diagnostic trace

Внутренний trace каждой P4 transaction: reason/time/sequence; ordered identities/sources; eligibility/reasons; normalized factors/scores; tie/winner/fallback; tuning version/optional explicit seed.

Без raw provider/memory text, OS/window identifiers, mutable refs. Public IPC/persistence/provider exposure требует отдельного Architect review/privacy boundary.

## 10. Coexistence и safety invariants

Сохраняются owners §1: Character — единственный semantic owner, Behavior Brain не сравнивает разные kinds, Runner не ждёт Skin и не становится параллельной FSM, Motion не выбирает behavior. Body/Skin не создают/не гейтят cadence. Provider необязателен, pulse его не вызывает. Shutdown отменяет scheduler без catch-up.

Новый public intent kind, IPC/port или Character threshold требует отдельного Architect review.

## 11. Проверяемые свойства

Повторяемость scores/ties/fallback; один resolved/sequence; P0–P3 вне Utility; peer P4 не прерывается pulse; нет копий sleep/quiet thresholds; offline/present provider candidates проходят общую boundary; trace не меняет outcome/контракты; render/animation/physics ticks не создают скрытую cadence.

## 12. AUTO-A09: admission и владение AI-занятием

Целевое дополнение [#45](https://github.com/zyzycode/project_wisp/issues/45); подключение runtime — #50.
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
Thinking — только dialogue presentation, не idle owner. Single-flight из #44 сохраняется:
timeout/reset retires result, но до settlement реального promise busy остаётся true.
Reset/reload/dispose инвалидируют generation и её offer/run; поздний result не допускается.
Periodic provider polling и параллельные запросы этим контрактом не вводятся.

## 13. AUTO-A09: локальная жизнь и ненавязчивость

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
Отсутствие pet input означает только отсутствие контакта; global user idle/return неизвестен.

Общий `InitiativeBudgetSnapshot` расходуется один раз при старте unsolicited cursor gesture/approach
или SocialBid, включая provider-инициативу. Gaze-only, спокойная одиночная игра и ручной P1 бесплатны.
Отказ до старта не расходует budget. Отмена после старта не возвращает token.
Помимо existing Activity cooldown требуется `nowMs >= nextEligibleAtMs` и свободный token
фиксированного окна; граница окна вычисляется по Main time, без interval timer и catch-up эпизодов.
При quiet/menu/disable сохраняются budget/cooldown и сбрасываются pending initiatives/dwell.
Resume допускает один свежий выбор, не накопленные приветствия.

## 14. Обязательные инварианты и tuning AUTO-A09

Порядок источников, once-only, конечность deadlines/budget, отсутствие resume/очереди и единые owners
обязательны. Числа ниже — начальный **versioned tuning** для #46–#50; изменения требуют
детерминированных сценариев, но не нового public kind/threshold. Не заявляют OS smoke.

| Параметр | Начальное значение |
|---|---|
| `offerTtlMs` / `maxSafeDeferMs` / `maxProviderRunMs` | 30000 / 3000 / 20000 ms |
| Initiative window / max episodes / minimum interval | 120000 ms / 2 / 30000 ms |
| Cursor episode / суммарный approach distance | 6000 ms / 160 DIP |
| Social wait | 4000 ms |
| Calm lifetime | 5000–11000 ms, существующая idle tuning range |

Все durations/distances конечны и положительны; counts — положительные целые; tuning version
обязательна в trace. Cursor freshness/dwell остаются Perception-owned, не копируются сюда.
Trace bounded (начально 64 decisions): gates, factors, winner, ownership, receipt, run result;
provider raw text, память, OS IDs и публичный debug IPC не добавляются.
