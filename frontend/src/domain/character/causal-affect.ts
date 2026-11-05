/** Verified local facts. Application binds these to the accepted input and activity run. */
export interface CausalObservedEvent {
  readonly sequence: number;
  readonly source: 'user' | 'system' | 'autonomy' | 'unknown';
  readonly triggerSequence: number | null;
  readonly activityRunId: string | null;
  readonly activity: 'cursor_game' | null;
  readonly outcome: 'completed' | 'cancelled' | 'failed' | null;
  readonly cause: 'contact' | 'completed' | 'user_interrupted' | 'environment_lost' | 'timeout' | 'other' | 'unknown';
  readonly executedMs: number;
  readonly participation: 'user_engaged' | 'solitary' | 'none';
}

export interface CausalEmotion {
  readonly causeSequence: number;
  readonly cause: CausalObservedEvent['cause'];
  readonly kind: 'content' | 'curious' | 'irritated';
  readonly intensity: number;
  readonly target: 'user' | 'environment' | 'self';
}

/** Optional affect can only modestly lower a social/game choice, never its admission. */
export function causalEmotionMultiplier(emotion?: Pick<CausalEmotion, 'kind' | 'intensity'> | null): number {
  if (emotion?.kind !== 'irritated' || !Number.isFinite(emotion.intensity)
      || emotion.intensity < 0 || emotion.intensity > 1) return 1;
  return Math.max(0.8, 1 - 0.2 * emotion.intensity);
}

export interface CausalAffectState {
  readonly emotion: CausalEmotion | null;
  /** Current trajectory without the reversible report factor; retains decay and other relief. */
  readonly baselineIntensity: number | null;
  readonly interruptionTimes: readonly number[];
  readonly highWaterSequence: number;
  readonly lastMonotonicMs: number | null;
}

export function createCausalAffectState(): CausalAffectState {
  return { emotion: null, baselineIntensity: null, interruptionTimes: [], highWaterSequence: 0, lastMonotonicMs: null };
}

function validTime(state: CausalAffectState, nowMs: number): boolean {
  return Number.isFinite(nowMs) && nowMs >= 0 && (state.lastMonotonicMs === null || nowMs >= state.lastMonotonicMs);
}

export function decayCausalAffect(state: CausalAffectState, nowMs: number): CausalAffectState {
  if (!validTime(state, nowMs)) return state;
  const elapsed = state.lastMonotonicMs === null ? 0 : Math.min(nowMs - state.lastMonotonicMs, 60_000);
  const factor = 2 ** (-elapsed / 30_000);
  const intensity = (state.emotion?.intensity ?? 0) * factor;
  return { ...state, lastMonotonicMs: nowMs,
    interruptionTimes: state.interruptionTimes.filter(time => nowMs - time < 60_000),
    baselineIntensity: state.emotion && intensity >= 0.05 ? (state.baselineIntensity ?? state.emotion.intensity) * factor : null,
    emotion: state.emotion && intensity >= 0.05 ? { ...state.emotion, intensity } : null };
}

/** No Needs, relationship, consent, personality or activity effects are paid here. */
export function appraiseCausalEvent(state: CausalAffectState, event: CausalObservedEvent, nowMs: number, contactHabituation = 0): CausalAffectState {
  if (!validTime(state, nowMs) || !Number.isSafeInteger(event.sequence) || event.sequence <= state.highWaterSequence
      || !Number.isFinite(event.executedMs) || event.executedMs < 0) return state;
  const next = { ...decayCausalAffect(state, nowMs), highWaterSequence: event.sequence };
  const makeEmotion = (kind: CausalEmotion['kind'], intensity: number, target: CausalEmotion['target']): CausalEmotion =>
    ({ causeSequence: event.sequence, cause: event.cause, kind, intensity, target });
  const trustedTrigger = event.source === 'user' && Number.isSafeInteger(event.triggerSequence) && event.triggerSequence !== null && event.triggerSequence > 0;
  if (event.cause === 'contact') {
    return event.source === 'user' && event.activity === null && event.activityRunId === null && event.outcome === null && event.executedMs === 0
      ? withEmotion(next, makeEmotion('curious', 0.1 / (1 + Math.max(0, Math.min(4, contactHabituation))), 'self')) : next;
  }
  if (event.activity !== 'cursor_game' || !event.activityRunId || event.outcome === null) return next;
  if (event.cause === 'completed' && event.outcome === 'completed' && event.participation === 'user_engaged') {
    return withEmotion(next, makeEmotion('content', 0.2, 'user'));
  }
  if (event.cause === 'user_interrupted' && event.outcome === 'cancelled' && trustedTrigger && event.executedMs >= 1_000) {
    return { ...withEmotion(next, makeEmotion('irritated', Math.min(0.6, 0.2 + 0.1 * next.interruptionTimes.length), 'user')),
      interruptionTimes: [...next.interruptionTimes, nowMs].slice(-4) };
  }
  if (event.cause === 'environment_lost' || event.cause === 'timeout') {
    return withEmotion(next, makeEmotion('irritated', 0.1, 'environment'));
  }
  return next;
}

function withEmotion(state: CausalAffectState, emotion: CausalEmotion): CausalAffectState {
  return { ...state, emotion, baselineIntensity: emotion.intensity };
}

/** Reinterprets only a still-current cause; it never replays an event or changes a facet. */
export function reappraiseInterruption(state: CausalAffectState, causeSequence: number,
  status: 'unknown' | 'reported_accidental' | 'reported_deliberate' | 'contradicted', nowMs: number): CausalAffectState {
  if (!validTime(state, nowMs)) return state;
  const current = decayCausalAffect(state, nowMs), emotion = current.emotion;
  if (!emotion || emotion.causeSequence !== causeSequence || emotion.cause !== 'user_interrupted'
    || emotion.kind !== 'irritated' || current.baselineIntensity === null) return current;
  const intensity = current.baselineIntensity * (status === 'reported_accidental' ? 0.5 : 1);
  return { ...current, emotion: intensity >= 0.05 ? { ...emotion, intensity } : null,
    baselineIntensity: intensity >= 0.05 ? current.baselineIntensity : null };
}
