# Контракт Shimeji Engine

Source of truth для Phase 14: Activity, drag/throw physics, gaze/cursor reactions и environment boundary. Дополняет [`CHARACTER_ENGINE.md`](./CHARACTER_ENGINE.md), [`BEHAVIOR_INTENTS.md`](./BEHAVIOR_INTENTS.md), [`ANIMATION_ENGINE.md`](./ANIMATION_ENGINE.md) и [`RENDER_ENGINE.md`](./RENDER_ENGINE.md).

## 1. Границы и поток данных

```text
Environment adapters -> EnvironmentSnapshot --------------------------+
Character Engine -> Behavior Brain -> Activity Runner -> AnimationIntent -> FSM -> Render
                                      -> voluntary locomotion ---------+
Drag/release/support -> Motion Engine -> MotionEvent -> FSM -----------+-> world transform
Environment + presentation geometry -> Gaze Engine -------------------+-> gaze presentation
Gaze Engine -> CursorProximitySignal -> Behavior Brain
Motion/Activity/user event -> ShimejiFeedbackEvent -> Application mapper -> StimulusDto -> Character Engine
```

| Модуль | Владеет | Не владеет |
|---|---|---|
| Behavior Brain | eligibility и weighted Activity selection | physics, frames |
| Activity Runner | lifecycle одной Activity, `AnimationIntent`, voluntary command | Render Engine |
| Animation FSM | pose/locomotion transitions и visual interrupt policy | behavior choice |
| Motion Engine | forced position при drag/fall/collision | autonomous choice |
| Gaze Engine | pupil presentation и proximity signal | Activity/locomotion launch |
| Character Engine | Needs, Relationship, Personality, Intimacy, tone, stimulus reduction | physics/render |
| Application/adapters | snapshots, clocks, mapping, OS data | domain decisions |

В forced-motion run ровно один position owner — Motion Engine. Application возвращает authority voluntary locomotion только когда physics уже `grounded` **и** landing/recover FSM вошёл в стабильный `settle`; Renderer не владеет world-position.

## 2. Координаты и Motion Engine

`WorldPx` — logical desktop pixel/DIP; world origin top-left, `x` вправо, `y` вниз, координаты могут быть отрицательными. `SourcePx` — source-canvas pixel Render Engine. Скорость — `WorldPx/s`, ускорение — `WorldPx/s²`, physics delta — секунды; timestamps/durations — monotonic ms. `MotionState.position` — root/contact pivot.

```typescript
export type MonotonicMs = number;
export type WorldPx = number;
export type SourcePx = number;
export interface Vector2Dto { readonly x: number; readonly y: number }
export type MotionPhase = 'dragged' | 'airborne' | 'grounded';
export type AirborneCause = 'throw_release' | 'voluntary_jump' | 'support_lost';
export interface AirborneLaunch { readonly cause: AirborneCause; readonly position: Vector2Dto; readonly velocityPxPerSec: Vector2Dto; readonly boundsId: string; readonly atMs: MonotonicMs }
export interface ThrowVector { readonly vxPxPerSec: number; readonly vyPxPerSec: number; readonly sampledAtMs: MonotonicMs; readonly sampleCount: number; readonly sampleSpanMs: number }
export interface ScreenBoundsDto { readonly id: string; readonly x: WorldPx; readonly y: WorldPx; readonly width: WorldPx; readonly height: WorldPx }
export interface CollisionInsets { readonly left: WorldPx; readonly right: WorldPx; readonly top: WorldPx; readonly bottom: WorldPx }
export interface ThrowSamplingConstraints { readonly windowMs: number; readonly maxSamples: number; readonly minSpanMs: number; readonly maxThrowSpeedPxPerSec: number }
export interface MotionConstraints {
  readonly gravityPxPerSec2: number; readonly linearDampingXPerSec: number; readonly linearDampingYPerSec: number; readonly fixedStepSec: number; readonly maxFrameDeltaSec: number; readonly maxSpeedPxPerSec: number;
  readonly wallRestitution: number; readonly ceilingRestitution: number; readonly floorRestitution: number; readonly floorTangentialRetention: number;
  readonly minBounceNormalSpeedPxPerSec: number; readonly settleNormalSpeedPxPerSec: number; readonly settleTangentialSpeedPxPerSec: number;
  readonly softLandingMaxSeverity: number; readonly stumbleMaxSeverity: number;
  readonly collisionInsets: CollisionInsets; readonly throwSampling: ThrowSamplingConstraints;
}
export type LandingOutcome = 'soft_landing' | 'stumble' | 'crash_landing';
export interface MotionState { readonly phase: MotionPhase; readonly position: Vector2Dto; readonly velocityPxPerSec: Vector2Dto; readonly activeBoundsId: string; readonly airborneElapsedSec: number; readonly peakGroundImpactSeverity: number }
export type MotionEvent =
  | { readonly type: 'drag_started'; readonly atMs: MonotonicMs } | { readonly type: 'released'; readonly throwVector: ThrowVector } | { readonly type: 'airborne_started'; readonly cause: AirborneCause; readonly atMs: MonotonicMs }
  | { readonly type: 'collision'; readonly side: 'left' | 'right' | 'top' | 'bottom'; readonly normalSpeedPxPerSec: number }
  | { readonly type: 'landed'; readonly outcome: LandingOutcome; readonly impactSeverity: number };
export interface MotionStepResult { readonly state: MotionState; readonly events: readonly MotionEvent[] }
export interface PointerMotionSample { readonly position: Vector2Dto; readonly capturedAtMs: MonotonicMs }
export interface MotionStepInput { readonly state: MotionState; readonly stepSec: number; readonly bounds: ScreenBoundsDto }
export interface IMotionEngine {
  beginDrag(state: MotionState, pivotPosition: Vector2Dto, boundsId: string, atMs: MonotonicMs): MotionStepResult; updateDraggedPosition(state: MotionState, pivotPosition: Vector2Dto): MotionState;
  estimateThrow(samples: readonly PointerMotionSample[], releaseAtMs: MonotonicMs): ThrowVector; release(state: MotionState, throwVector: ThrowVector): MotionStepResult; beginAirborne(state: MotionState, launch: AirborneLaunch): MotionStepResult;
  step(input: MotionStepInput): MotionStepResult;
}
export const DEFAULT_MOTION_CONSTRAINTS: MotionConstraints = {
  gravityPxPerSec2: 1800, linearDampingXPerSec: 0.35, linearDampingYPerSec: 0.08,
  fixedStepSec: 1 / 120, maxFrameDeltaSec: 0.25, maxSpeedPxPerSec: 2400,
  wallRestitution: 0.45, ceilingRestitution: 0.30, floorRestitution: 0.30, floorTangentialRetention: 0.72,
  minBounceNormalSpeedPxPerSec: 160, settleNormalSpeedPxPerSec: 120, settleTangentialSpeedPxPerSec: 90,
  softLandingMaxSeverity: 420, stumbleMaxSeverity: 950, collisionInsets: { left: 50, right: 50, top: 90, bottom: 10 },
  throwSampling: { windowMs: 100, maxSamples: 8, minSpanMs: 24, maxThrowSpeedPxPerSec: 2200 },
};
```

Validation: positive bounds/steps; non-negative damping/speeds; restitution/retention in `[0,1]`; `minBounce >= settleNormal`; `softLandingMax < stumbleMax`; legal inset range non-empty. Sprite packs may override only collision insets; other tuning goes through `MotionConstraints`.

### 2.1. Sliding-window throw vector

Sort samples, collapse duplicate timestamps keeping the last, then take at most `maxSamples` where `t_i >= releaseAtMs - windowMs`. If fewer than two or span `< minSpanMs`, velocity is `(0,0)`. Otherwise weighted least squares:
```text
τ_i = (t_i - t_(n-1)) / 1000;  w_i = i + 1
τ̄ = Σ(w_i τ_i) / Σw_i;  x̄ = Σ(w_i x_i) / Σw_i;  ȳ = Σ(w_i y_i) / Σw_i
vx_raw = Σ[w_i(τ_i - τ̄)(x_i - x̄)] / Σ[w_i(τ_i - τ̄)²]
vy_raw = Σ[w_i(τ_i - τ̄)(y_i - ȳ)] / Σ[w_i(τ_i - τ̄)²]
s = sqrt(vx_raw² + vy_raw²);  k = min(1, maxThrowSpeed / max(s, ε))
vx = vx_raw × k;  vy = vy_raw × k
```
Zero denominator gives `(0,0)`. Pointer/root samples are equivalent under constant grab offset; two-last-sample or `movementX/Y` estimation is invalid. `release` converts `ThrowVector` to `AirborneLaunch(cause='throw_release')`. Approved jump supplies `voluntary_jump` position/impulse; lost or invalid support supplies `support_lost` current position/velocity. `beginAirborne` resets airborne counters and emits `airborne_started`; every value is explicit.

### 2.2. Fixed-step semi-implicit Euler

```text
Motion.step(input), h = input.stepSec:
  vy_accel = vy(t) + gravity × h
  vx(t+h) = vx(t) × exp(-linearDampingX × h)
  vy(t+h) = vy_accel × exp(-linearDampingY × h)
  speed = sqrt(vx(t+h)² + vy(t+h)²)
  velocity = velocity × min(1, maxSpeed / max(speed, ε))
  x(t+h) = x(t) + vx(t+h) × h
  y(t+h) = y(t) + vy(t+h) × h
// Application/orchestrator; accumulator is not Domain/Motion state
frameDelta = clamp(renderDeltaSec, 0, maxFrameDeltaSec); applicationAccumulator += frameDelta
while applicationAccumulator >= h, h = fixedStepSec:
  result = motion.step({ state, stepSec: h, bounds }); state = result.state
  applicationAccumulator -= h
```
Application сохраняет remainder. Motion не хранит accumulator/clock и при одинаковых `MotionStepInput` + `MotionConstraints` возвращает одинаковый result; render FPS не участвует в Domain math.

### 2.3. Collision, bounce, landing

```text
minX = bounds.x + insets.left;  maxX = bounds.x + bounds.width - insets.right
minY = bounds.y + insets.top;   maxY = bounds.y + bounds.height - insets.bottom
left/right: vx_after = -wallRestitution × vx_before
top:        vy_after = -ceilingRestitution × vy_before
bottom bounce: vy_after = -floorRestitution × vy_before
               vx_after = floorTangentialRetention × vx_before
normalImpact = max(0, vy_before);  tangentialImpact = abs(vx_before)
impactSeverity = sqrt(normalImpact² + 0.25 × tangentialImpact²)
peak = max(previousPeak, impactSeverity)
```
Clamp penetration; reflect only outward velocity. Bounce when `normalImpact > minBounceNormalSpeed`. Otherwise `y=maxY`, `vy=0`, and each step `vx *= floorTangentialRetention` until:
```text
normalImpact <= settleNormalSpeed AND abs(vx_after) <= settleTangentialSpeed AND abs(y-maxY) <= ε
```
Then grounded: `y=maxY; vx=vy=0`; emit once:
```text
peak <= softLandingMaxSeverity -> soft_landing
peak <= stumbleMaxSeverity     -> stumble
peak >  stumbleMaxSeverity     -> crash_landing
```
Side/top collisions do not determine landing. Bounds update only between steps; invalid support запускается только явным `beginAirborne(...cause='support_lost')`. Domain physics receives DTO/config/delta and never calls Electron, DOM, Node, timers, `screen` or OS APIs.

## 3. Forced motion, FSM и приоритеты

```text
Voluntary: Behavior Brain -> Activity -> AnimationIntent/FSM + voluntary locomotion
Forced: Drag/support/release/collision -> Motion Engine -> MotionEvent -> same FSM
```
Behavior Brain never decides whether Wisp falls, collides or lands. Application converts approved `jump` and adapter-reported lost/invalid support into explicit `beginAirborne` launches. Forced motion suspends voluntary commands and cancels (never pauses) active Activity; `grounded` alone не возвращает position authority — требуется также стабильный `settle` после landing/recover.

| Motion event | FSM request | Policy |
|---|---|---|
| `drag_started` | `START_DRAG` / `dragged` | critical, non-interruptible |
| `airborne_started: throw_release/support_lost/voluntary_jump` | `RELEASE_DRAG` or `FALL` -> `fall` | resolved at least high |
| `landed: soft_landing` | `LAND` / `land` -> `settle` | high |
| `landed: stumble` | `stumble` -> `settle` | high, bounded |
| `landed: crash_landing` | `crash_landing` -> `recover` -> `settle` | high, bounded |

`falling/fall` and `landing/land` are compatibility aliases at Controller boundary. `stumble`, `crash_landing`, `recover` are additive kinds/states in the same Animation contract/FSM. Combined states such as `walk_look_left` are forbidden.

| Rank | Source | Interruption |
|---|---|---|
| P0 forced physics | invalid support/fall/collision/landing | cancels active Activity; invariant cannot be rejected |
| P1 user | drag/click/pet/explicit command | cancels P2–P5; airborne drag starts after atomic physics step |
| P2 critical need | required sleep/wake | cancels P3–P5; waits for P0/P1 |
| P3 reactive | spook/cursor/Zoomies | cancels P4–P5 |
| P4 autonomous | Explore/optional Rest/wander | replaces P5; peers do not replace by default |
| P5 ambient | blink/micro-idle | interrupted by all higher ranks |

`START_DRAG` cancels Activity as `user_interaction`; fall as `forced_motion`. Click may wake/cancel Rest. Zoomies may replace Explore only after gates/cooldown. Critical Need cannot override drag/fall. Every interruption is cancel+new `runId`, never pause/resume. Activity rank is distinct from `AnimationPriority`.

## 4. Activity Runner, repetition и cooldown

```typescript
export type ActivityId = string; export type ActivityStepId = string; export type ActivityActionId = string; export type ActivityConditionId = string; export type CooldownKey = string;
export type ActivityStepTarget = ActivityStepId | 'complete' | 'cancel';
export type ActivityPriorityClass = 'P0_forced_physics' | 'P1_user_interaction' | 'P2_critical_need' | 'P3_reactive' | 'P4_autonomous' | 'P5_ambient';
export type RunnableActivityPriorityClass = Exclude<ActivityPriorityClass, 'P0_forced_physics'>;
export interface AnimationIntentTemplate { readonly kind: AnimationIntent['kind']; readonly category?: AnimationIntent['category']; readonly expressionHint?: AnimationIntent['expressionHint']; readonly propHint?: AnimationIntent['propHint']; readonly loop?: AnimationIntent['loop'] }
export type ActivityStepCompletion = { readonly type: 'animation_completed'; readonly timeoutMs: number } | { readonly type: 'state_entered'; readonly state: AnyAnimationState; readonly timeoutMs: number } | { readonly type: 'elapsed'; readonly durationMs: number };
export interface ActivityStepBase { readonly id: ActivityStepId; readonly actionId: ActivityActionId; readonly guard?: ActivityConditionId; readonly next?: ActivityStepId | 'complete'; readonly onGuardFalse?: ActivityStepTarget }
export interface AnimationActivityStep extends ActivityStepBase { readonly type: 'animation'; readonly intent: AnimationIntentTemplate; readonly completion: ActivityStepCompletion }
export interface VoluntaryLocomotionStep extends ActivityStepBase { readonly type: 'locomotion'; readonly gait: 'walk' | 'run' | 'crawl'; readonly targetRef: string; readonly intent: AnimationIntentTemplate; readonly timeoutMs: number }
export interface DelayActivityStep extends ActivityStepBase { readonly type: 'delay'; readonly durationMs: number }
export interface BranchActivityStep extends ActivityStepBase { readonly type: 'branch'; readonly condition: ActivityConditionId; readonly whenTrue: ActivityStepId | 'complete'; readonly whenFalse: ActivityStepTarget }
export type ActivityStep = AnimationActivityStep | VoluntaryLocomotionStep | DelayActivityStep | BranchActivityStep;
export interface ActivityDefinition { readonly id: ActivityId; readonly priority: RunnableActivityPriorityClass; readonly baseWeight: number; readonly entryStepId: ActivityStepId; readonly steps: readonly ActivityStep[]; readonly cooldownKey?: CooldownKey; readonly tags?: readonly string[] }
export interface ActivityContext { readonly nowMs: MonotonicMs; readonly character: Readonly<CharacterState>; readonly synthesizedTone: SynthesizedEmotionalTone; readonly environment: EnvironmentSnapshot; readonly cursorSignal?: CursorProximitySignal; readonly repetition: RepetitionHistory; readonly cooldowns: CooldownState }
export type ActivityRuntimeStatus = 'running' | 'completed' | 'cancelled' | 'failed';
export interface ActivityRuntimeState { readonly runId: string; readonly activityId: ActivityId; readonly status: ActivityRuntimeStatus; readonly currentStepId: ActivityStepId; readonly startedAtMs: MonotonicMs; readonly stepStartedAtMs: MonotonicMs; readonly activeAnimationRequestId?: string; readonly activeLocomotionRequestId?: string }
export type ActivityCancelReason = 'forced_motion' | 'user_interaction' | 'critical_need' | 'higher_priority_activity' | 'environment_invalidated' | 'animation_rejected' | 'step_timeout' | 'explicit_cancel' | 'application_shutdown';
export type ActivityResult = { readonly status: 'completed'; readonly activityId: ActivityId; readonly completedAtMs: MonotonicMs } | { readonly status: 'cancelled'; readonly activityId: ActivityId; readonly reason: ActivityCancelReason; readonly cancelledAtMs: MonotonicMs } | { readonly status: 'failed'; readonly activityId: ActivityId; readonly reason: 'invalid_definition' | 'unresolved_target'; readonly failedAtMs: MonotonicMs };
```

`ActivityChain` stores ordered `steps`, but control flow references only `ActivityStepId`. `entryStepId` and every target must resolve to a unique step; weights/timeouts are positive finite and unconditional branch cycles invalid. Guards/targets are domain tokens, not callbacks. One Activity runs at once. Runner emits intent/voluntary command, waits completion, records history/cooldown and cleans only its `runId`; no direct Render calls. `requestedBy` remains `BehaviorIntentKind | system`; correlation stays outside `AnimationIntent`.

```text
Explore: walk(target) -> observe -> sit -> look_around -> stand_up
Rest: yawn -> lie_down -> sleep_start -> sleep_loop (complete on stable state)
```

Semantic `observe/look_around/yawn` action ids use current AnimationIntent fallback until separately added; Runner never creates FSM states dynamically. Branch steps allow future conditions without a Behavior Tree framework.

### 4.1. RepetitionPenalty

```typescript
export interface RecentActivityEntry { readonly activityId: ActivityId; readonly selectedAtMs: MonotonicMs; readonly result: 'completed' | 'cancelled' }
export interface RecentActionEntry { readonly actionId: ActivityActionId; readonly animationKind: AnimationIntent['kind']; readonly shownAtMs: MonotonicMs }
export interface RepetitionHistory { readonly activities: readonly RecentActivityEntry[]; readonly actions: readonly RecentActionEntry[] }
export interface RepetitionPenalty { readonly activityHistorySize: number; readonly actionHistorySize: number; readonly activityHalfLifeMs: number; readonly actionHalfLifeMs: number; readonly activityStrength: number; readonly actionStrength: number; readonly minActivityMultiplier: number; readonly minActionMultiplier: number }
```

Ring sizes: Activity `8`, action `16`; cancelled run is recorded only after a step starts. Starting policy: half-lives `5 min`/`90 s`, strengths `0.9`/`0.6`, minima `0.15`/`0.25`.

```text
activityScore(c) = Σ exp(-ln(2) × (now-entry.selectedAt) / activityHalfLife), matching activityId
q(c,e) = matching actionId-or-animationKind steps / max(1, visual steps in c)
actionScore(c) = Σ q(c,e) × exp(-ln(2) × (now-entry.shownAt) / actionHalfLife)
activityModifier = max(minActivityMultiplier, exp(-activityStrength × activityScore))
actionModifier = max(minActionMultiplier, exp(-actionStrength × actionScore))
repetitionModifier = activityModifier × actionModifier
finalWeight = baseWeight × environmentModifier × needModifier × toneModifier × personalityModifier × repetitionModifier
P(c) = finalWeight(c) / Σ finalWeight(eligible candidates)
```

Penalty never bans: a sole candidate uses minimum multiplier; zero total weight falls back to P5 idle. History sizes are positive integers, half-lives/strengths positive, minima in `(0,1]`.

### 4.2. Cooldown

```typescript
export interface CooldownRule { readonly key: CooldownKey; readonly durationMs: number; readonly startsOn: 'start' | 'completion' | 'any_finish' }
export interface CooldownEntry { readonly key: CooldownKey; readonly nextEligibleAtMs: MonotonicMs }
export interface CooldownState { readonly entries: readonly CooldownEntry[] }
```

```text
eligible(rule, now) = no entry(rule.key) OR now >= nextEligibleAtMs
nextEligibleAtMs = triggerTime + durationMs
```

Cooldown is a hard gate, penalty is a weight. Zoomies/rare/Stretch/Swat have separate keys; wake sets `sleep_after_wake` (P2 emergency may explicitly bypass it). Expensive visible events normally start cooldown on `start`. Durations are non-negative tuning data; one entry per key.

## 5. Gaze, cursor и environment

```typescript
export interface CursorSample { readonly globalPosition: Vector2Dto; readonly capturedAtMs: MonotonicMs }
export type GazeTarget = { readonly type: 'cursor'; readonly sample: CursorSample } | { readonly type: 'world_point'; readonly globalPosition: Vector2Dto } | { readonly type: 'neutral' };
export interface GazeGeometry { readonly rootGlobalPosition: Vector2Dto; readonly gazeOriginSourcePx: Vector2Dto; readonly scale: number; readonly flipX: boolean }
export interface GazeInput { readonly nowMs: MonotonicMs; readonly deltaSec: number; readonly target: GazeTarget; readonly geometry: GazeGeometry }
export interface PupilOffset { readonly xSourcePx: SourcePx; readonly ySourcePx: SourcePx }
export interface GazeConstraints { readonly attentionRadiusWorldPx: number; readonly deadZoneSourcePx: number; readonly maxPupilOffsetXSourcePx: number; readonly maxPupilOffsetYSourcePx: number; readonly smoothingTimeSec: number; readonly maxCursorAgeMs: number }
export interface GazeState { readonly mode: 'tracking' | 'returning_to_neutral' | 'neutral'; readonly target?: GazeTarget; readonly pupilOffset: PupilOffset; readonly updatedAtMs: MonotonicMs }
export interface IGazeEngine { update(previous: GazeState, input: GazeInput, constraints: GazeConstraints): GazeState }
export interface CursorReactionConstraints { readonly attentionRadiusWorldPx: number; readonly swatRadiusWorldPx: number; readonly swatDwellMs: number; readonly signalMaxAgeMs: number; readonly swatCooldownKey: CooldownKey }
export interface CursorProximitySignal { readonly cursor: CursorSample; readonly distanceToRootWorldPx: number; readonly withinAttentionRange: boolean; readonly withinSwatRange: boolean; readonly dwellWithinSwatRangeMs: number; readonly emittedAtMs: MonotonicMs }
export interface CursorProximityState { readonly withinSwatRange: boolean; readonly dwellWithinSwatRangeMs: number; readonly updatedAtMs: MonotonicMs }
export interface CursorProximityInput { readonly nowMs: MonotonicMs; readonly rootGlobalPosition: Vector2Dto; readonly cursor?: CursorSample; readonly compatible: boolean }
export interface CursorProximityUpdate { readonly state: CursorProximityState; readonly signal?: CursorProximitySignal }
export interface ICursorProximityEngine { update(previous: CursorProximityState, input: CursorProximityInput, constraints: CursorReactionConstraints): CursorProximityUpdate }
```

Require `scale,max offsets,smoothingTime > 0`, other values non-negative, and `attentionRadiusWorldPx > deadZoneSourcePx × scale`. For cursor, `targetGlobal=sample.globalPosition`; for world point, its `globalPosition`:

```text
dx_world = targetGlobal.x-rootGlobal.x;  dy_world = targetGlobal.y-rootGlobal.y
dx_source = dx_world/scale;  dy_source = dy_world/scale;  dx_local = (flipX ? -dx_source : dx_source)-gazeOriginSourcePx.x
dy_local = dy_source-gazeOriginSourcePx.y
d = sqrt(dx_local²+dy_local²)
strength = clamp((d-deadZoneSourcePx) / max(attentionRadiusWorldPx/scale-deadZoneSourcePx, ε), 0, 1)
if d <= deadZone: desired=(0,0)
else desired.x=(dx_local/d)×maxOffsetX×strength; desired.y=(dy_local/d)×maxOffsetY×strength
r = sqrt((desired.x/maxOffsetX)²+(desired.y/maxOffsetY)²); if r>1: desired=desired/r; alpha = 1-exp(-max(deltaSec,0)/smoothingTimeSec)
offset(t+dt) = offset(t)+alpha×(desired-offset(t))
```

Missing/stale (`now-sampleAt > maxCursorAge`) or out-of-radius cursor sets desired `(0,0)` and returns smoothly to neutral. `flipX` applies once. Gaze emits no Activity/AnimationIntent. Baked-in faces may no-op pupil presentation without suppressing proximity signal.

Cursor update is pure; initial state is `{withinSwatRange:false,dwellWithinSwatRangeMs:0,updatedAtMs:nowMs}`. Then `fresh = cursor exists AND 0<=nowMs-capturedAtMs<=signalMaxAgeMs`; compute world distance when present, `within = compatible AND fresh AND distance<=swatRadius`; `elapsed=max(0,nowMs-previous.updatedAtMs)`; `dwell'=within ? (previous.withinSwatRange ? previous.dwellWithinSwatRangeMs+elapsed : 0) : 0`. Missing cursor returns no signal; stale/out/incompatible resets dwell; no timer/hidden state exists.

Swat eligibility:

```text
withinSwatRange AND dwell >= swatDwellMs AND signalAge <= signalMaxAgeMs
AND cooldown expired AND context/personality/needs allow AND state compatible
```

Starting thresholds: `swatRadiusWorldPx=64`, `swatDwellMs=450`. Reset dwell on exit/stale/missing/incompatible state. Suppress during dragged, fall/falling, land/landing, crash/recover, sleep_start/sleep_loop/wake_up. Look-at is gaze; swat/chase/avoid are P3 Activity decisions.

```typescript
export type SurfaceKind = 'screen_floor' | 'window_top' | 'unknown';
export interface SurfaceSnapshotDto { readonly id: string; readonly kind: SurfaceKind; readonly bounds: { readonly x: WorldPx; readonly y: WorldPx; readonly width: WorldPx; readonly height: WorldPx }; readonly supportY?: WorldPx; readonly isValidSupport: boolean }
export interface EnvironmentSnapshot { readonly capturedAtMs: MonotonicMs; readonly screenBounds: ScreenBoundsDto; readonly cursor?: CursorSample; readonly currentSurface?: SurfaceSnapshotDto }
```

Snapshot is immutable. Adapter selects usable work area and normalizes OS limitations; absent cursor/surface means unavailable. No handles, PID, z-order, platform/source names. Test and production snapshots are equivalent; future window-awareness only adds serializable geometry/capability DTO.

## 6. Character Engine: Needs, Mood, Stimuli

`Mood` means derived `SynthesizedEmotionalTone`, never mutable state. Shimeji reads a snapshot; Character Engine alone clamps/metabolizes Needs, progresses Relationship/Personality/Intimacy and resynthesizes tone.

Все числовые gates/коэффициенты Needs, tone, Personality и stimulus intensity/delta в §6 — стартовый tuning-профиль, передаваемый конфигурацией, а не неизменная архитектура. Инварианты контракта — диапазоны, формы формул, категории, ownership и idempotency; реализация не hardcode-ит эти числа в ветвях selector/reducer.

```typescript
export interface ActivitySelectionContext { readonly character: Readonly<CharacterState>; readonly synthesizedTone: SynthesizedEmotionalTone; readonly environment: EnvironmentSnapshot; readonly repetition: RepetitionHistory; readonly cooldowns: CooldownState; readonly activePriority?: ActivityPriorityClass }
```

```text
E=clamp(energy/100,0,1); B=clamp((boredom??15)/100,0,1)
P=clamp(play/100,0,1); C=clamp(comfort/100,0,1)
stimulationNeed=max(B,P); restNeed=max(1-E,C)
```

| Activity | Eligibility | `needModifier` |
|---|---|---|
| Explore/walk | `E>0.20`, no forced/critical sleep | `(0.35+1.25B)×(0.40+0.60E)` |
| Run | `E>0.30`, no forced/critical sleep | `(0.20+1.80×stimulationNeed)×(0.30+1.20E)` |
| Sit/lie | no P0/P1; below P2 Sleep | `(0.35+1.65(1-E))×(0.80+0.40C)` |
| Optional Rest | `sleep_after_wake` expired; no P0/P1 | `0.10+2.40×restNeed²` |
| Zoomies | `E>=.65 AND B>=.75 AND P>=.50 AND C<.80`, cooldown expired | `(0.50+2.50B²)×(0.50+1.50E²)×(0.50+P)` |

`energy<=20 OR comfort>=80` creates deterministic P2 Sleep; P0/P1 may delay it. Otherwise Rest is weighted and rechecks sleep permission at its sleep step. Zoomies rarity comes from gates, low base weight, P3, cooldown and penalty.

| Tone | Explore | Run | Sit | Rest | Zoomies | Swat |
|---|---:|---:|---:|---:|---:|---:|
| shy | .85 | .65 | 1.35 | 1.10 | .45 | .55 |
| sleepy | .35 | .15 | 1.40 | 2.00 | .05 | .10 |
| playful | 1.15 | 1.45 | .65 | .45 | 1.80 | 1.50 |
| curious | 1.40 | 1.05 | .90 | .75 | .85 | 1.10 |
| neutral | 1 | 1 | 1 | 1 | 1 | 1 |
| affectionate | .90 | .85 | 1.10 | 1 | .65 | 1.15 |
| flustered | .75 | .55 | 1.35 | 1.10 | .30 | .35 |

```text
personalityExplore=.50+.60×openness+.25×independence
personalityRun=.60+.55×playfulness+.25×extraversion
personalitySit=.75+.25×sensitivity+.20×(1-extraversion)
personalityRest=.80+.25×sensitivity+.20×independence
personalityZoomies=.25+.90×playfulness+.45×boldness
personalitySwat=.40+.70×playfulness+.35×boldness
```

Axes use clamped `.current`; positive personality/tone modifiers alter probability, not safety gates.

| Brain decision | Canonical `BehaviorIntent` | Activity detail |
|---|---|---|
| Explore/walk/run | `wander` | gait/target |
| Sit/observe | `idle` | pose/steps |
| Rest/Sleep | `sleep` | lie -> sleep start/loop |
| Zoomies/Swat/chase | `play` | P3 Activity |
| direct drag | `drag` | P1 + forced authority |
| landing | `land` | outcome presentation chain |

Activity-specific public intent kinds require coordinated update of `BEHAVIOR_INTENTS.md`; provider/timer cannot forge physics/user stimuli.

### 6.1. Feedback stimuli

```typescript
export type StimulusDto = StimulusEvent;
export type ShimejiFeedbackEvent =
  | { readonly type: 'drag_started'; readonly eventId: string; readonly atMs: MonotonicMs } | { readonly type: 'drag_hold'; readonly eventId: string; readonly dragRunId: string; readonly heldMs: number; readonly atMs: MonotonicMs }
  | { readonly type: 'drag_ended'; readonly eventId: string; readonly dragRunId: string; readonly heldMs: number; readonly atMs: MonotonicMs }
  | { readonly type: 'landing'; readonly eventId: string; readonly outcome: LandingOutcome; readonly impactSeverity: number; readonly atMs: MonotonicMs }
  | { readonly type: 'petting'; readonly eventId: string; readonly intensity: number; readonly atMs: MonotonicMs } | { readonly type: 'swat_cursor_completed'; readonly eventId: string; readonly activityRunId: string; readonly atMs: MonotonicMs };
export interface ShimejiStimulusMappingContext { readonly createdAtIso: string; readonly landingThresholds: Pick<MotionConstraints, 'stumbleMaxSeverity'> }
export interface IShimejiStimulusMapper { map(event: ShimejiFeedbackEvent, context: ShimejiStimulusMappingContext): StimulusDto | null }
```

Domain emits semantic event/monotonic duration. Configured mapper/reducer attach stable id, ISO time, source, primitive metadata and tuning deltas using the same landing/stimulus profile; Application deduplicates `StimulusDto.id`.

| Feedback | `StimulusDto.type/source` | Intensity | metadata `shimejiEvent` |
|---|---|---:|---|
| drag start | `user_drag_start/user` | 1 | `drag_started` |
| drag hold | `system_event/user` | `clamp(heldMs/1000,1,3)` | `drag_hold`, run id, held ms |
| drag end | `user_drag_end/user` | 1 | `drag_ended`, run id, held ms |
| soft landing | none | — | drag end covers it |
| stumble | `system_event/system` | 1 | `stumble`, severity |
| crash | `system_event/system` | `clamp(severity/stumbleMaxSeverity,1,3)` | `crash_landing`, severity |
| pet | `user_pet/user` | `clamp(event.intensity,0,3)` | `petting` |
| swat completed | `system_event/system` | 1 | `swat_cursor_completed`, run id, `initiatedBy=user_cursor` |

`drag_hold` emits once per run after `heldMs>=1000`; swat rewards only successful completion after cooldown. Raw pointer/DOM/OS data never enters stimulus.

| Event delta per intensity | energy | attention | play | comfort | boredom | friendship | love/intimacy |
|---|---:|---:|---:|---:|---:|---:|---|
| drag_started | -.2 | -2 | — | — | -2 | — | — |
| drag_hold | -.5 | -2 | — | +3 | -3 | — | — |
| drag_ended | — | — | — | — | — | — | lifecycle |
| stumble | -2 | — | — | +3 | -3 | — | — |
| crash_landing | -6 | — | — | +10 | -4 | — | — |
| petting | -.6 | -9 | — | -6 | -5 | +4 | love +2, charge +1.5 |
| swat_cursor_completed | -2 | -2 | -10 | — | -12 | +1 | — |

Character Engine clamps Needs `[0,100]`/Relationship `[0,1000]`. Pet retains personality deltas `agreeableness +.002`, `sensitivity -.001`; love uses `loveUnlocked`, while consent gates expression. Other events do not mutate Personality; crash/drag do not reduce Relationship. Mapper never forces `metadata.tone`: tone is resynthesized. `surprised` remains presentation-only.

Order: landing chain is accepted, stimulus applied once, new tone becomes visible to Brain only after settle/recover. For pet/drag start, apply stimulus before building reaction tone. Frames/substeps/bounces never create extra stimuli.

## 7. Animation, Render и изоляция

```text
Behavior/Activity -> AnimationIntent -> one Animation FSM -> Resolver/Player -> RenderPresentationState
MotionEvent -> same FSM; MotionState.position -> host/world placement
GazeState -> Presentation Composer -> compatible pupil layer (or no-op)
body + face/expression + gaze + props/effects + overlays + scale/flip + world placement = presentation
```

No Cartesian states (`walk_look_left`, `sit_look_left`). `RenderPresentationState.layers`, `proceduralBlush`, `rootPivot`, `transform.flipX/scale` remain Render authority; missing assets cannot block Activity/physics/sleep completion.

Motion/Activity/Gaze/Character math contains no Electron/BrowserWindow/screen/IPC, React/DOM/CSS/devicePixelRatio, Node timers/filesystem, OS/window handles, asset paths/frames, provider/backend DTO, mutable CharacterState or direct Needs/Relationship mutations. Platform data enters only normalized immutable DTO through Application/adapters.
