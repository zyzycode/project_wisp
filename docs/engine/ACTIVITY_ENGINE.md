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

Это Activity chains, не public behavior catalog; compatibility задаёт Brain. Visual kinds/transitions — [Animation](ANIMATION_ENGINE.md), physical feasibility — [Motion](MOTION_ENGINE.md). Миграция не создаёт отдельный каталог в `docs/behaviors/`.

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

Типы: [activity-runner.ts](../../src/domain/behavior/activity-runner.ts). Одновременно максимум один run; каждый старт имеет новый уникальный `runId`. Terminal `completed`/`failed`/`cancelled` детерминирован и необратим; interruption — cancelled с причиной.

Runner принимает `nowMs`, не создаёт timers; выпускает максимум один step request за update transition, сохраняет `stepStartedAtMs`/Brain deadline для bounded step. Causal guard/locomotion event сопоставляется только с current run; stale/foreign игнорируются без мутации. Cleanup scope возвращается только для завершившегося run.

## 8. Completion и timeouts

Только объявленное условие: `nowMs >= phaseEndsAtMs` для bounded animation/pose; authoritative Motion/Application target/result; explicit delay elapsed; guard outcome; bounded timeout. Application задаёт стабильный sequence для causal event/deadline одной transaction; Runner лишь сравнивает переданное monotonic time со start/deadline.

Skin completion, visual FSM, RAF, `BodyEventDTO` не завершают steps. Legacy `animation_completed`/`state_entered`, external animation request IDs/timeouts — migration debt до AUTO-I08; после AUTO-A08 каждая semantic visual phase имеет Brain duration/deadline. Skin completion/repeat/truncation/fallback не меняет timeline.

Step completion атомарно переходит к target и выпускает следующий request; terminal завершает run ровно один раз.

## 9. Guards и branches

Guard читает immutable normalized context/event, не мутирует engines/environment и не вызывает provider. Missing outcome/invalid target/exception → deterministic failed, без произвольной ветки. Для другого behavior завершить/отменить chain; новый candidate проходит Character на следующей opportunity.

## 10. Interruption и cancel

Всегда cancel + новый run, без pause/resume. P0 → `forced_motion`, P1 → `user_interaction`; остальные ranks — [Autonomy P0–P5](AUTONOMY_ENGINE.md#3-safety-order-p0p5).

Cancel прекращает emissions и возвращает точный cleanup scope; доставленный physical fact не откатывается. Body применяет свои visual interrupt rules локально, Runner не подменяет их и не ждёт outcome.

## 11. Cooldown

`CooldownEntry { key, nextEligibleAtMs }` — hard gate по explicit monotonic time, отдельно от repetition. Zoomies/rare actions/Stretch/Swat имеют отдельные keys. `sleep_after_wake` обходит только P2 по Autonomy/Character. Durations — tuning data, новых значений здесь нет.

Обновлять только по объявленному lifecycle event; render frame, scoring attempt, rejected candidate, невыбранная Activity и stale event cooldown не продлевают.

## 12. Repetition

Bounded history: до 8 Activity entries и 16 action entries; вытеснение старых, exponential time decay. Положительный configured floor сохраняет шанс единственной eligible Activity; это soft weight, не hard gate. Записи добавляет только подтверждённый start/execution lifecycle event, не preview/eligibility/repeated scoring.

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

Drag start/hold/end → user stimuli; `stumble`/`crash_landing` → system; petting/completed Swat → configured deltas. Soft landing, raw pointer events, physics substeps/bounces/frames не размножают feedback. Application дедуплицирует eventId; hold — максимум один на run после configured hold, completed feedback связан с `activityRunId`.

Character clamp-ит шкалы/синтезирует tone. Новый selection snapshot публикуется только после landing `settle`/`recover`, без arbitration посреди forced motion.

## 14. Изоляция

Brain/Runner — чистые `src/domain/behavior/`, [общая изоляция](README.md#5-общие-архитектурные-границы-и-изоляция-clean-architecture). Renderer не выбирает/не исполняет Activity; Application оркестрирует normalized time/events/completion.

## 15. Проверяемые свойства

Проверять §3–12: выбор внутри resolved intent, один active run, invalid-definition rejection, stale-event no-op, cancel без resume, hard cooldown/positive repetition, детерминизм при одинаковых inputs/RNG, отсутствие semantic/physics/visual-priority решений Activity.

### AUTO-I06: Explore и Rest Spot

`rest-spot-planner.ts`/`explore-planner.ts` разделяют bounded target/route/action history. External candidates только из fresh Application snapshot. До scoring — reachable same-support walk/traverse или проверенная directed arc; screen approach/grab/climb/rebound сохраняется в Explore. Нельзя пересекать параболой внутренность наблюдаемого окна; изменение target geometry в полёте отменяет arc → обычные fall/land.

Rest Spot только внутри resolved `sleep`: reachable window top предпочтительнее тихой кромки/угла пола, затем safe floor. На окне `sit_edge → settle`; опора уже 240 DIP или край допускают только сидячую подготовку/сон, широкий центр/пол — `lie_down`/`sleep_loop`. Clips задают fallback, не Brain duration; [арт-долг](../art/SPRITE_REQUESTS.md).

Nap: prepare 1200 ms → settle 1500 ms → sleep 12000 ms → wake 1500 ms → awake и единственный opportunity scheduler. `vital_sleep`/user sleep без nap deadline: после prepare sleep до energy ≥80, прямого действия или потери опоры. Click/drag, menu pause, disable/shutdown отменяют Rest Spot. Небольшое смещение принятой опоры сохраняет local distance (Motion §7.1).

Sleep phase/stable sleep использует существующий `sleepy` metabolism CharacterStateService; approach/prepare — нет. Новый needs timer запрещён.

## 16. AUTO-A09: единый outcome и ownership

Target [ActivityOutcomeFeedback](../../src/application/ports/shimeji-feedback-port.ts)/[OwnedActivityRun](../../src/application/ports/behavior-admission-port.ts) подключаются #46/#50 вокруг существующего Runner; Domain не импортирует Application. Effective rank хранится рядом с run в Brain по причине/источнику запуска: одинаковый kind не уравнивает user/local/provider. [Admission/deadlines](AUTONOMY_ENGINE.md#12-auto-a09-admission-и-владение-ai-занятием).

Request/admission/started/terminal — разные факты. User `play` проходит Character gate **до** игрового эффекта. Rejected/no compatible Activity не создаёт play stimulus/history/full cooldown; accepted/deferred не означает execution, start budget/history фиксируются только при started.

Любая ветка, включая cancel/failure/timeout/disable/shutdown, доставляет ровно один terminal outcome/cleanup; `clearedRunId` связывает `ActivityResult` с run.

Terminal snapshot содержит family/outcome/executedMs/participation/playCompleted. IDs/run непустые, `atMs`/`executedMs` finite nonnegative; execution не включает provider wait/defer, pause/resume нет. `playCompleted` true лишь после полной **Brain semantic play phase** Swat/gesture/Zoomies, не gaze/approach/arrival/social wave. Флаг сохраняется до terminal: cancel после игры может дать эффект, до — нет; Explore/calm/rest/social_bid → false. Application нормализует фактическое user engagement, не наличие курсора/provider source.

| Outcome | Mapping в существующий `StimulusDto` |
|---|---|
| Explore completed | `system_event`, metadata `activityOutcome=explore_completed`, `activityRunId`, `deltaMs=0`. |
| play/cursor_interest с `playCompleted=true` | `play`, intensity=1; metadata `activityRunId`, `participation`, `deltaMs=0`. |
| Cancel/failure до выполненной игровой фазы | `null`, без полного эффекта; реальный Motion feedback сохраняется. |
| calm/rest/cursor gaze/SocialBid без игры | `null`; только история, cooldown/budget и обычный метаболизм. |

Explore completed — конец route/action chain, не просто arrival. Deltas меняет Character reducer, mapper Needs не мутирует. В #46 `IActivityOutcomeStimulusMapper` атомарно заменяет старого consumer без второго handler. Legacy `swat_cursor_completed` сначала нормализуется в тот же completed-play key `activityRunId`, затем отдельная emission удаляется.

Dedupe по **eventId и run+effect semantic key**: новый eventId не повторяет эффект. Foreign/terminal run и прошлая generation игнорируются; bounded terminal ledger принадлежит Brain generation.

Drag start ID = dragRunId, один hold/end на известный run. Landing — один эффект на Motion landing episode после settle/recover; soft/bounce/substep/repeated IPC не добавляют эффект. Drag/landing не становятся play и не дают дружбы за перемещение. [Character deltas/recovery](CHARACTER_ENGINE.md#11-auto-a09-последствия-и-восстановление).

Terminal transaction: run/locomotion cleanup → once-only feedback → history/cooldowns → Character snapshot/gates → одна opportunity. Forced landing ждёт recover даже после пересчёта Needs. Game/Explore reward не зависит от Skin success и не пересчитывается на pulse.

### Проверки для implementation

Регрессии: rejected play не улучшает свой gate; Explore/Swat/Zoomies reward once-only, включая duplicate с новым ID; cancel до/после игры, no-start/foreign; drag cancel AI/nap/play сохраняет реальные physical consequences; immediate/safe-deferred AI дают максимум один run, timeout сохраняет safety; nap/full sleep используют существующий clock, wake возвращает один local flow.
