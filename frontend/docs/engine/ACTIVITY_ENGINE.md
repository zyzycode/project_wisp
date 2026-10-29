# Контракт Activity Engine

Definitions, selection, lifecycle, chains, guards, cooldown/repetition. Character передаёт один resolved `BehaviorIntent`; Activity не меняет его семантику.

## 1. Владение

Behavior Brain (Domain) выбирает совместимую `ActivityDefinition` внутри resolved kind; Runner (Domain) исполняет steps/run, guards, transitions, `AnimationIntent`, cancel/completion. Application доставляет monotonic time/causal events и оркестрирует deadlines. [Ownership](README.md#4-матрица-межмодульных-контрактов-кто-от-кого-зависит).

## 2. Поток Activity

`resolved intent + immutable context → Behavior Brain → one definition → Runner → AnimationIntent/phase timeline → BrainStateDTO`.
Voluntary locomotion идёт через Motion/Application; causal event/deadline/guard продвигает Runner, forced motion/direct input отменяет run, result/feedback возвращается Application.

Нет compatible Activity → отсутствие выбора; fallback остаётся semantic/Application flow, не скрытым новым intent. Semantic candidates Brain повторно не сравнивает.

## 3. ActivityDefinition

Конечный directed chain graph: unique Activity id, один `entryStepId`, interruption rank, finite positive `baseWeight`, optional `cooldownKey`, конечные steps с уникальными `ActivityStepId`.

Step — ровно один тип: semantic animation, voluntary locomotion, explicit delay, guarded branch; target существует либо terminal. Animation — только `AnimationIntent`-совместимая форма; locomotion не коммитит world position. Запрещены React/DOM, assets/frames, Electron/OS handles, provider DTO, mutable Character, wall-clock callbacks, произвольные effects.

## 4. Валидация definitions

До старта проверить: непустые уникальные IDs в своём scope; существующие entry/targets (либо terminal); finite positive weights/timeouts; зарегистрированный cooldown tuning key; отсутствие unconditional cycle; bounded exit/timeout у guarded cycle; один тип request на step; отсутствие неявного расширения `BehaviorIntentKind`/`AnimationIntentKind`.

Invalid graph не чинится/не угадывается: deterministic failed `invalid_definition`, без старта.

## 5. Начальные chains

```text
Explore: walk(target) -> observe -> sit -> look_around -> stand_up
Rest: yawn -> lie_down -> sleep_start -> sleep_loop (complete on stable state)
Zoomies: sprint(target) -> settle
```

Это Activity chains, не public behavior catalog; compatibility задаёт Brain. Visual kinds/transitions — [Animation](ANIMATION_ENGINE.md), physical feasibility — [Motion](MOTION_ENGINE.md). Миграция не создаёт отдельный каталог в `frontend/docs/behaviors/`.

## 6. Behavior Brain selection

Hard filters **до** weights: intent/state/guard compatibility, истёкший cooldown, нужная environment capability, отсутствие несовместимого forced-motion lifecycle, специальные eligibility rules.

Compatibility: `wander → Explore/Run`, `idle → Sit`, `sleep → Rest/Sleep`, `play → Zoomies/Swat`; `quiet` сам по себе не выбирает Rest/Sleep. Zoomies требует достаточных energy/stimulation, низкого overload и истёкшего cooldown; Character thresholds не переопределять.

```text
finalWeight = baseWeight
            × environment
            × need
            × tone
            × personality
            × repetition

P(activity) = finalWeight(activity) / Σ finalWeight(eligible activities)
```

Snapshot factors read-only; завершённую P4 Utility не пересчитывать. RNG — явный `randomUnit`/seeded source из orchestration; `Math.random()`/wall-clock reads запрещены. Нулевая сумма положительных weights → нет выбора.

## 7. Lifecycle одного run

Типы: [activity-runner.ts](../../src/domain/behavior/activity-runner.ts). Одновременно максимум один run; каждый старт имеет новый уникальный `runId`. Application создаёт opaque ID из возрастающего safe-integer счётчика и ограниченного injected factory suffix (100 символов, trailing whitespace после среза удаляется). Уникальность — по построению, без растущего Set всех run IDs; переполнение счётчика отклоняется. Поздние events по-прежнему сверяются с текущими run/step. Terminal `completed`/`failed`/`cancelled` детерминирован и необратим; interruption — cancelled с причиной.

Runner принимает `nowMs`, не создаёт timers; выпускает максимум один step request за update transition, сохраняет `stepStartedAtMs`/Brain deadline для bounded step. Causal guard/locomotion event сопоставляется только с current run; stale/foreign игнорируются без мутации. Cleanup scope возвращается только для завершившегося run.

## 8. Completion и timeouts

Только объявленное условие: `nowMs >= phaseEndsAtMs` для bounded animation/pose; authoritative Motion/Application target/result; explicit delay elapsed; guard outcome; bounded timeout. Application задаёт стабильный sequence для causal event/deadline одной transaction; Runner лишь сравнивает переданное monotonic time со start/deadline.

Skin completion, visual FSM, RAF, `BodyEventDTO` не завершают steps. Каждая semantic visual phase имеет Brain duration/deadline. Обратный handshake завершения анимации упразднён; Skin completion/repeat/truncation/fallback не меняет timeline.

Step completion атомарно переходит к target и выпускает следующий request; terminal завершает run ровно один раз.

## 9. Guards и branches

Guard читает immutable normalized context/event, не мутирует engines/environment и не вызывает provider. Missing outcome/invalid target/exception → deterministic failed, без произвольной ветки. Для другого behavior завершить/отменить chain; новый candidate проходит Character на следующей opportunity.

## 10. Interruption и cancel

Всегда cancel + новый run, без pause/resume. P0 → `forced_motion`, P1 → `user_interaction`; остальные ranks — [Autonomy P0–P5](AUTONOMY_ENGINE.md#3-safety-order-p0p5).

Cancel прекращает emissions и возвращает точный cleanup scope; доставленный physical fact не откатывается. Body применяет свои visual interrupt rules локально, Runner не подменяет их и не ждёт outcome.

### Направленная прогулка по просьбе

После [Character admission](CHARACTER_ENGINE.md#просьбы-о-движении-и-право-на-отказ) user `wander` выбирает одну детерминированную `chat_walk` Activity ранга P1: один locomotion step с gait=walk, без случайного Explore/inspection/прыжка/перелезания на другую опору. Application передаёт отдельно нормализованное направление из [ChatMotion](../../src/application/ports/chat-motion.ts); pure Domain planner вычисляет конечную цель из актуальных root position, collision range и текущей допустимой опоры. Геометрия не поступает из текста/provider.

Первый slice: не более 160 DIP в сторону экранной X, обычная настроенная walk speed, deadline 7000 ms; конец раньше при достижении цели. Цель ограничивается пересечением collision range и диапазона корня на текущей опоре (`screen_floor` или fresh `window_top`), Y остаётся на ней. Отсутствие положительного доступного смещения → `edge`, отсутствие допустимой опоры → `no_support`. Нельзя превращать clamp в ход в противоположную сторону. Drag, queued drag, fall, climb/hang/traversal, disabled/menu pause/shutdown не запускают прогулку; недопустимое движение отклоняется без очереди. Смена/потеря/устаревание опоры отменяет run; физический исход остаётся Motion. Никакой записи позиции/телепорта из chat runtime.

Только для подтверждённого grounded `screen_floor` допустимо отклонение root Y от floor Y не более 0.5 DIP внутри collision range: это погрешность существующей [native round projection](MOTION_ENGINE.md#8-авторитет-позиции-кто-двигает-окно). Planner сохраняет фактический root Y в цели, не исправляет позицию; штатная нормализация пола остаётся Motion. Отклонение больше 0.5 DIP и root вне collision range отклоняются как `no_support`. Для `window_top` этот допуск не применяется: прежние точность контакта, свежесть и валидность attachment сохраняются.

Одновременно одна chat-команда и один Runner. Каждая новая принятая chat-команда сначала отменяет прежнюю, затем проверяет новые gates и цель от фактической позиции. Stop прекращает chat locomotion; отсутствие такого run даёт честный no-op. Повтор направления начинает новый bounded run без очереди. Обычное принятое сообщение, прямой input, reset/reload/dispose, P0/P2 и invalid environment также отменяют run; обычный диалог не возобновляет его. Stop не останавливает падение/drag и не выключает последующую автономность.

Recognition, admission/start, completed, cancelled и rejected — разные факты. `started` возвращается только после реального успешного старта Runner/Motion. Completion — authoritative target/Runner terminal, timeout — cancellation, не успех. Request/conversation/generation/run identity ограждают terminal callbacks; старые результаты не двигают персонажа и не перезаписывают новый ответ. Terminal cleanup выполняется once-only и только для своего run. Автономный старт в той же transaction не должен немедленно заменить принятую прогулку.

## 11. Cooldown

`CooldownEntry { key, nextEligibleAtMs }` — hard gate по explicit monotonic time, отдельно от repetition. Zoomies/rare actions/Stretch/Swat имеют отдельные keys. `sleep_after_wake` обходит только P2 по Autonomy/Character. Durations — tuning data, новых значений здесь нет.

Обновлять только по объявленному lifecycle event; render frame, scoring attempt, rejected candidate, невыбранная Activity и stale event cooldown не продлевают.

## 12. Repetition

Bounded history: до 8 Activity entries и 16 action entries; вытеснение старых, exponential time decay. Положительный configured floor сохраняет шанс единственной eligible Activity; это soft weight, не hard gate. Записи добавляет только подтверждённый start/execution lifecycle event, не preview/eligibility/repeated scoring.

Calm выбирает существующие `idle_blink`/`look_around` взвешенно, без обязательного чередования: базовые веса 1.4/1, делённые на `1 + decayed recent pose count` (half-life 90 s). Используется нормализованная RNG-позиция внутри выбранной idle-корзины, без изменения вероятностей семейств. Длительность calm — `6500 + floor(random * 3500)` ms, один seeded draw при start; preview не расходует RNG. Это Main deadline, не ожидание завершения спрайта.

## 13. Feedback boundary

`ShimejiFeedbackEvent → Application mapper → StimulusDto` не более одного раза. Union/context/port: [shimeji-feedback-port.ts](../../src/application/ports/shimeji-feedback-port.ts); deltas/StimulusDto — [Character](CHARACTER_ENGINE.md).

| Variant `ShimejiFeedbackEvent` | Поля payload | Назначение и инвариант |
|---|---|---|
| `drag_started` | `eventId`, `atMs` | Ровно один semantic start на drag run. |
| `drag_hold` | `eventId`, `dragRunId`, `heldMs`, `atMs` | Не более одного события после configured hold; `heldMs` конечен и неотрицателен. |
| `drag_ended` | `eventId`, `dragRunId`, `heldMs`, `atMs` | Ровно один terminal outcome для известного run. |
| `landing` | `eventId`, `outcome`, `impactSeverity`, `atMs` | `LandingOutcome`; severity конечна и неотрицательна, soft landing не создаёт stimulus. |
| `petting` | `eventId`, `intensity`, `atMs` | Нормализованная intensity конечна и находится в `[0, 1]`. |
| `swat_cursor_completed` | `eventId`, `activityRunId`, `atMs` | Только подтверждённое завершение текущего Activity run. |

| Mapping contract | Назначение | Инвариант |
|---|---|---|
| `eventId` / `atMs` | Общая identity и Main-monotonic метка события | ID непустой и дедуплицируется; время конечно и неотрицательно. |
| `ShimejiStimulusMappingContext.createdAtIso` | UTC-время создаваемого stimulus | Валидная ISO-8601 строка, формируется Application boundary. |
| `landingThresholds.stumbleMaxSeverity` | Минимальный context для landing mapping | Берётся из текущих `MotionConstraints`, не копируется в Domain event. |
| `IShimejiStimulusMapper.map(...)` | Преобразовать semantic feedback в `StimulusDto` или `null` | Чистое deterministic mapping; не применяет stimulus и не владеет дедупликацией. |

Drag start/hold/end → user stimuli; `stumble`/`crash_landing` → system; petting/completed Swat → configured deltas. Soft landing, raw pointer events, physics substeps/bounces/frames не размножают feedback. Application обеспечивает дедупликацию в текущем lifecycle: start/hold/end flags текущего drag run и consumed flag landing episode. Monotonic session ordinal исключает повтор ID фабрики; закрытые drag sessions/устаревшие sequence отклоняются до feedback, история ID не накапливается; hold — максимум один на run после configured hold, completed feedback связан с `activityRunId`.

Character clamp-ит шкалы/синтезирует tone. Новый selection snapshot публикуется только после landing `settle`/`recover`, без arbitration посреди forced motion.

## 14. Изоляция

Brain/Runner — чистые `frontend/src/domain/behavior/`, [общая изоляция](README.md#5-общие-архитектурные-границы-и-изоляция-clean-architecture). Renderer не выбирает/не исполняет Activity; Application оркестрирует normalized time/events/completion.

## 15. Проверяемые свойства

Проверять §3–12: выбор внутри resolved intent, один active run, invalid-definition rejection, stale-event no-op, cancel без resume, hard cooldown/positive repetition, детерминизм при одинаковых inputs/RNG, отсутствие semantic/physics/visual-priority решений Activity.

### Семантика Explore и Rest Spot

`rest-spot-planner.ts`/`explore-planner.ts` разделяют bounded target/route/action history. External candidates только из fresh Application snapshot. До scoring — reachable same-support walk/traverse или проверенная directed arc; screen approach/grab/climb/rebound сохраняется в Explore. Нельзя пересекать параболой внутренность наблюдаемого окна; изменение target geometry в полёте отменяет arc → обычные fall/land.

Отдельная session-only retry memory хранит максимум 12 неудачных target IDs на 30 s. Movement rejection, `environment_invalidated` и `step_timeout` во время locomotion временно исключают цель Explore/Rest; user/forced/shutdown cancel и завершение inspection не добавляют запись. Preview/scoring не продлевают срок; на границе expiry цель снова доступна. Это не успешная visit/action history, не cooldown и не persistence. Prepare/settle/wake Rest и pose Explore используют конечный клип с удержанием terminal pose до semantic deadline; повтор перехода не заменяет удержание.

Rest Spot только внутри resolved `sleep`: reachable candidates оцениваются общим score с мягкими множителями edge/corner ×1.35 и window top ×1.2. Категория не получает безусловного приоритета над repetition/history; tie-break — target ID. Safe stationary rest остаётся кандидатом. На окне `sit_edge → settle`; опора уже 240 DIP или край допускают только сидячую подготовку/сон, широкий центр/пол — `lie_down → sleep_start → sleep_loop`. Clips задают fallback, не Brain duration; арт-долг (исторический реестр удалён; требования — в отчёте задачи).

Nap: prepare 1200 ms → settle 1500 ms → sleep 12000 ms → wake 1500 ms → awake и единственный opportunity scheduler. `vital_sleep`/user sleep без nap deadline: после prepare sleep до energy ≥80, прямого действия или потери опоры. Click/drag, menu pause, disable/shutdown отменяют Rest Spot. Небольшое смещение принятой опоры сохраняет local distance (Motion §7.1).

Sleep phase/stable sleep использует существующий `sleepy` metabolism CharacterStateService; approach/prepare — нет. Новый needs timer запрещён.

<a id="16-auto-a09-единый-outcome-и-ownership"></a>
## 16. Единый outcome и ownership

Компоненты [ActivityOutcomeFeedback](../../src/application/ports/shimeji-feedback-port.ts) и [OwnedActivityRun](../../src/application/ports/behavior-admission-port.ts) оборачивают Runner; Domain не импортирует Application. Effective rank хранится рядом с run в Brain по причине/источнику запуска: одинаковый kind не уравнивает user/local/provider. [Admission/deadlines](AUTONOMY_ENGINE.md#12-auto-a09-admission-и-владение-ai-занятием).

Request/admission/started/terminal — разные факты. User `play` проходит Character gate **до** игрового эффекта. Rejected/no compatible Activity не создаёт play stimulus/history/full cooldown; accepted/deferred не означает execution, start budget/history фиксируются только при started.

Любая ветка, включая cancel/failure/timeout/disable/shutdown, доставляет ровно один terminal outcome/cleanup; `clearedRunId` связывает `ActivityResult` с run.

Terminal snapshot содержит family/outcome/executedMs/participation/playCompleted. IDs/run непустые, `atMs`/`executedMs` finite nonnegative; execution не включает provider wait/defer, pause/resume нет. `playCompleted` true лишь после полной **Brain semantic play phase** Swat/gesture/Zoomies, не gaze/approach/arrival/social wave. Флаг сохраняется до terminal: cancel после игры может дать эффект, до — нет; Explore/calm/rest/social_bid → false. Application нормализует фактическое user engagement, не наличие курсора/provider source.

| Outcome | Mapping в существующий `StimulusDto` |
|---|---|
| Explore completed | `system_event`, metadata `activityOutcome=explore_completed`, `activityRunId`, `deltaMs=0`. |
| play/cursor_interest с `playCompleted=true` | `play`, intensity=1; metadata `activityRunId`, `participation`, `deltaMs=0`. |
| Cancel/failure до выполненной игровой фазы | `null`, без полного эффекта; реальный Motion feedback сохраняется. |
| calm/rest/cursor gaze/SocialBid без игры | `null`; только история, cooldown/budget и обычный метаболизм. |

Explore completed — конец route/action chain, не просто arrival. Deltas меняет Character reducer, mapper Needs не мутирует. `IActivityOutcomeStimulusMapper` обрабатывает завершение без дублирующих обработчиков. Событие `swat_cursor_completed` нормализуется в completed-play key `activityRunId`.

Dedupe по **eventId и run+effect semantic key**: новый eventId не повторяет эффект. Foreign/terminal run и прошлая generation игнорируются; bounded terminal ledger принадлежит Brain generation.

Drag start ID = dragRunId, один hold/end на известный run. Landing — один эффект на Motion landing episode после settle/recover; soft/bounce/substep/repeated IPC не добавляют эффект. Drag/landing не становятся play и не дают дружбы за перемещение. [Character deltas/recovery](CHARACTER_ENGINE.md#11-auto-a09-последствия-и-восстановление).

Terminal transaction: run/locomotion cleanup → once-only feedback → history/cooldowns → Character snapshot/gates → одна opportunity. Forced landing ждёт recover даже после пересчёта Needs. Game/Explore reward не зависит от Skin success и не пересчитывается на pulse.

### Проверки для implementation

Регрессии: rejected play не улучшает свой gate; Explore/Swat/Zoomies reward once-only, включая duplicate с новым ID; cancel до/после игры, no-start/foreign; drag cancel AI/nap/play сохраняет реальные physical consequences; immediate/safe-deferred AI дают максимум один run, timeout сохраняет safety; nap/full sleep используют существующий clock, wake возвращает один local flow.

## 17. Cursor game v1

Целевое расширение `cursor_interest` в существующем Domain/behavior, без нового public BehaviorIntentKind. Нормализованный результат и tuning — [cursor-game-contract.ts](../../src/application/ports/cursor-game-contract.ts); Domain получает значения явными входами, не импортирует Application. Perception владеет [freshness и достижимостью](PERCEPTION_ENGINE.md#61-cursor-game-v1-ограниченное-преследование), Motion — фактическим перемещением, Activity — фазами/исходом, Application — локальным текстом, feedback и публикацией. Backend не участвует в control loop.

| Фаза | Завершение и переход |
|---|---|
| notice | `look_around`, 600 ms; затем approach либо attempt, если reaction gate уже выполнен. |
| approach | Одна walk leg к фиксированной цели; после arrival свежий reaction gate → attempt, иначе допустимый retarget → следующая leg. |
| attempt | `cursor_play`, 1000 ms; в конце один authoritative checkpoint свежего proximity. Попытка максимум одна на run. |
| reaction | `happy_reaction` при caught, `confused_reaction` при missed/lost_target, 600 ms. |
| settle | `settle`, 600 ms, затем terminal completed. |

Новый leg/attempt допускается только если до общего deadline остаётся соответственно время на его bounded выполнение + attempt/reaction/settle (2200 ms для полного хвоста). Notice входит в 6000 ms; leg timeout не позже deadline−2200 ms. Если времени/целей/travel больше нет, но fresh reachable cursor остаётся — missed → reaction/settle, пока позволяет общий deadline. На deadline немедленный terminal; не доигрывать reaction после него. Cancel не запускает новую реакцию и не задерживает P0/P1/P2. Для lost_target остановить voluntary leg, затем bounded reaction/settle только при сохранении безопасной опоры и оставшегося времени.

`caught`: в конце полной attempt-фазы cursor fresh и withinSwatRange; игровая условная поимка, ОС-курсор не захватывается. `missed`: fresh reachable cursor вне swat radius на checkpoint либо исчерпан chase budget. `lost_target`: отсутствующий/stale/out-of-area/unreachable cursor или утрата опоры, если не сработал более приоритетный cancel. `cancelled`: пользователь, forced physics, mode/lifecycle cancellation; deadline без уже установленного outcome даёт missed при fresh reachable cursor, иначе lost_target. Порядок совпавших условий: P0/P1/P2/mode/lifecycle → deadline → lost_target → checkpoint → retarget. Зафиксированный caught/missed/lost_target больше не меняется, но status run может стать cancelled; результат публикуется ровно один раз на terminal.

`CursorGameResult.playCompleted=true` только после всей attempt-фазы, независимо от caught/missed; chase/notice/time exhaustion до attempt не дают reward. `executedMs` — фактическое время semantic run, не provider wait. Result мапится в существующий ActivityOutcome и once-only stimulus (§16) по `activityRunId`; новый путь не дублирует `swat_cursor_completed`. Cancel после завершённой попытки сохраняет флаг; награда и изменения Needs принадлежат Character. Исход не создаёт дополнительный relationship bonus и не записывает автоматически устойчивое предпочтение пользователя.

Локальные реплики, конечный ru/en каталог и каталог реплик определены в [UI §6.1.1](UI_SPEC.md#611-cursor-game-v1-presentation), character/experience selection — в [Character §8.1](CHARACTER_ENGINE.md#81-game-a01-характер-локальной-игровой-речи). Одна attempt-реплика и максимум одна outcome-реплика на run; quiet/отмена скрывают речь. Renderer отображает projection, не определяет исход/текст; raw game geometry в UI не отправляется. Новый selector не меняет физические исходы, rewards и animation intents выше.

Visual phases используют готовые intent/assets: notice/look_around, walk, cursor_play, happy_reaction, confused_reaction, settle. Новые спрайты и новые public visual kinds не требуются; Render/Animation сохраняют выбор clip и fallback. Отдельные авторские catch/miss sheets могут появиться позже через SPRITE_REQUESTS, а физический успех от них не зависит.

Implementation consequences: заменить fixed-target episode на bounded legs в существующих Activity/Motion adapters без live retarget команды; нормализовать result и локальную speech projection, сохранить один owner/cooldown/budget. Проверки: caught/missed/lost/cancel, stale ровно после TTL, checkpoint ровно на deadline, 4-target/160-DIP/6000-ms caps, moving support, interrupted attempt до/после playCompleted, duplicate terminal и отсутствие LLM-вызовов. История между перезапусками и inference предпочтений — отдельная Memory-задача; этот runtime-контракт не задаёт новую persistence schema.

## 18. Законченные сцены внимания (SCENE-A01)

Сцена — наблюдаемая последовательность существующей Activity и принятого пользовательского ввода, не новый engine/executor или сохраняемая сущность. Первый набор содержит две сцены; выбор использует текущие Needs/отношения/traits и gates Character/Autonomy, без новых порогов или обхода quiet/sleep.

| Сцена | Повод и уже существующий путь | Завершение и точный пробел |
|---|---|---|
| Игра с курсором | Fresh reachable dwell → notice → bounded approach/attempt → caught/missed/lost_target → reaction → settle (§17). Needs/отношения влияют на admission/выбор, не доказывают участие человека. | Полная цепочка уже реализована. Сохранить caps, реакции и once-only feedback; не создавать вторую игру или новое сближение. |
| Приглашение к контакту | Обычный local P4 SocialBid → notice/wave → wait; одна допустимая second вместо wave использует curious head-tilt по [Autonomy §13.2](AUTONOMY_ENGINE.md#132-одна-дополнительная-попытка-после-молчания-soc-a01). | При молчании текущий wait сразу заканчивается idle. Целевое изменение: явное невербальное окончание ниже; при принятом контакте штатная P1 реакция заменяет приглашение сразу. |

### 18.1. Окончание приглашения без ответа

Только обычные local P4 first/second: после полного wait выполнить `disengage` с existing `look_around` 800 ms, затем `settle` 600 ms, затем terminal completed. Оба шага stage=exiting, bounded animation по Brain time, в том же run; первый шаг означает «огляделась и переключилась на свои дела», не обиду/отказ пользователя. Первый wait сохраняет переданный bounded wait, второй — максимум 4000 ms. Эти длительности — единый Domain tuning для этой сцены, не дополнительные timers. System/P3 return сохраняет прежний путь без этого хвоста.

Existing `social-bid-activity.ts` владеет definition; Application/ActivityRunner публикует фазы, Main возобновляет обычный выбор после terminal. Никаких обязательного похода, гарантированного следующего занятия, нового public intent, очереди или дополнительного RNG draw. Семантический `settle` использует существующий `body_idle`; выразительное отличие даёт предшествующий `body_look_around`, а не само имя settle. При недоступном клипе действует текущий Render fallback, без влияния на timeline. Отдельный head-turn/relax арт вне этого slice.

`unanswered` фиксируется только по completed после обоих шагов. Follow-up окно считается от этого настоящего terminal T; его условия, token/cooldown и silence latch остаются в Autonomy, третьей попытки нет. Переход wait→disengage или disengage→settle не вызывает новых onStarted/socialStarted, speech, provider, memory/learning, ActivityOutcome или Character stimulus. Final SocialBid по-прежнему не play и не имеет отдельной награды/штрафа (§16; Character activity feedback).

### 18.2. Контакт, потеря цели и отмена

Accepted direct chat/pet/P1 input к Wisp — фактический контакт; он закрывает pending social chain до async работы и немедленно отменяет current SocialBid, включая disengage/settle. Выполняется обычная реакция на этот input, без ожидания хвоста, дополнительного happy-gesture или второго reward. Ответная реакция зависит от текущего состояния и режима; отказанный/busy/duplicate send контактом не является. Молчание, пассивный курсор, provider reply, внешняя клавиатура/мышь и возврат пользователя не подтверждают внимание или удовольствие.

Stationary SocialBid не имеет cursor target, поэтому потеря курсора не превращается в lost_target. В игре потеря fresh/reachable target и forced support loss обрабатываются по §17 и Motion. Quiet/quietSupport, menu/disable, сон/critical gate, drag/forced physics, lifecycle reset/dispose и смена владельца отменяют несовместимую сцену штатно: хвост не доигрывается и не возобновляется, stale callbacks не создают terminal/награду/новую инициативу. На совпавшем tick приоритет cancellation выше перехода фазы и completion. Existing правила Character/Autonomy сохраняют допускаемые спокойные занятия.

### 18.3. Проверка наблюдаемого результата

Deterministic проверки: полный first/second путь и точные границы фаз; отсутствие раннего terminal и duplicate effects; контакт в wait/disengage/settle; quiet/critical/forced/lifecycle interruption; follow-up от нового terminal T и отсутствие третьей попытки; system/P3 return без нового хвоста. Существующая игра покрывает caught/missed/lost/cancel и возврат к автономности без повторного implementation.

Native Electron-сцены: (1) достижимый курсор → игра → видимая реакция → свои занятия; (2) приглашение без ответа → оглядывание → спокойное завершение; (3) контакт во время ожидания/окончания → немедленная обычная реакция, без отложенного оглядывания. Зафиксировать commit/OS/режим/использованные clips или fallback. Unit timeline доказывает последовательность, но не выразительность арта; недоступную native-проверку указывать NOT RUN. Для isolated первого slice mock/offline достаточен, новые AI-вызовы не нужны.
