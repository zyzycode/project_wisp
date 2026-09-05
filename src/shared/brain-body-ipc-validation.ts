import type {
  BodyEventDTO,
  BrainActivityTimelineDTO,
  BrainEmotionalToneDTO,
  BrainMotionStateDTO,
  BrainStateDTO,
  BrainVisualIntentDTO,
} from './ipc-contracts';

const MAX_ID_LENGTH = 128;

const EMOTIONAL_TONES = [
  'shy',
  'sleepy',
  'playful',
  'curious',
  'neutral',
  'affectionate',
  'flustered',
] as const;

const VISUAL_KINDS = [
  'idle_blink',
  'walk',
  'settle',
  'sleep_start',
  'sleep_loop',
  'wake_up',
  'happy_reaction',
  'confused_reaction',
  'thinking_loop',
  'talking',
  'bored',
  'wave',
  'celebrate',
  'spook',
  'dragged',
  'land',
  'sit',
  'stand_up',
  'lie_down',
  'get_up',
  'run',
  'jump',
  'fall',
  'crawl',
  'climb_wall',
  'hang_ceiling',
  'crash_landing',
] as const;

const VISUAL_CATEGORIES = [
  'idle',
  'movement',
  'reaction',
  'dialogue',
  'sleep',
  'gesture',
  'transition',
  'physics',
] as const;

const EXPRESSION_HINTS = [
  'idle',
  'blush',
  'happy',
  'winking',
  'pout',
  'curious',
  'thinking',
  'sleepy',
  'surprised',
  'shocked',
  'sad',
  'angry',
  'talking',
  'flying',
  'gaze',
  'dizzy',
  'flirty',
] as const;

function invalidContract(): never {
  throw new TypeError('Invalid Brain/Body IPC payload');
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalidContract();
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) invalidContract();
  } catch {
    invalidContract();
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(
  record: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = []
): void {
  const allowed = new Set([...required, ...optional]);
  let keys: readonly PropertyKey[];
  try {
    keys = Reflect.ownKeys(record);
  } catch {
    invalidContract();
  }
  if (
    keys.some((key) => typeof key !== 'string' || !allowed.has(key)) ||
    required.some((key) => !Object.hasOwn(record, key))
  ) {
    invalidContract();
  }
  for (const key of keys) {
    if (typeof key !== 'string') invalidContract();
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) invalidContract();
  }
}

function own(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) invalidContract();
  return descriptor.value;
}

function literal<const T extends readonly string[]>(value: unknown, allowed: T): T[number] {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    invalidContract();
  }
  return value as T[number];
}

function finiteNumber(value: unknown, minimum?: number, maximum?: number): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    (minimum !== undefined && value < minimum) ||
    (maximum !== undefined && value > maximum)
  ) {
    invalidContract();
  }
  return value;
}

function safeInteger(value: unknown, minimum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    invalidContract();
  }
  return value;
}

function boundedId(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_ID_LENGTH ||
    value.trim() !== value
  ) {
    invalidContract();
  }
  return value;
}

function position(value: unknown): { readonly x: number; readonly y: number } {
  const record = asRecord(value);
  requireExactKeys(record, ['x', 'y']);
  return { x: finiteNumber(own(record, 'x')), y: finiteNumber(own(record, 'y')) };
}

function parseActivity(value: unknown, sampledAtMs: number): BrainActivityTimelineDTO | null {
  if (value === null) return null;
  const record = asRecord(value);
  requireExactKeys(record, [
    'runId',
    'activityId',
    'phaseId',
    'stage',
    'startedAtMs',
    'phaseStartedAtMs',
    'phaseEndsAtMs',
  ]);
  const startedAtMs = finiteNumber(own(record, 'startedAtMs'), 0);
  const phaseStartedAtMs = finiteNumber(own(record, 'phaseStartedAtMs'), 0);
  const rawPhaseEndsAtMs = own(record, 'phaseEndsAtMs');
  const phaseEndsAtMs = rawPhaseEndsAtMs === null
    ? null
    : finiteNumber(rawPhaseEndsAtMs, 0);
  if (
    startedAtMs > phaseStartedAtMs ||
    phaseStartedAtMs > sampledAtMs ||
    (phaseEndsAtMs !== null && (phaseEndsAtMs <= sampledAtMs || phaseEndsAtMs < phaseStartedAtMs))
  ) {
    invalidContract();
  }
  return {
    runId: boundedId(own(record, 'runId')),
    activityId: boundedId(own(record, 'activityId')),
    phaseId: boundedId(own(record, 'phaseId')),
    stage: literal(own(record, 'stage'), ['entering', 'looping', 'exiting'] as const),
    startedAtMs,
    phaseStartedAtMs,
    phaseEndsAtMs,
  };
}

function parseMotion(value: unknown): BrainMotionStateDTO {
  const record = asRecord(value);
  requireExactKeys(record, [
    'phase',
    'rootScreenPosition',
    'velocityPxPerSec',
    'positionAuthority',
  ]);
  return {
    phase: literal(own(record, 'phase'), ['dragged', 'airborne', 'grounded'] as const),
    rootScreenPosition: position(own(record, 'rootScreenPosition')),
    velocityPxPerSec: position(own(record, 'velocityPxPerSec')),
    positionAuthority: literal(own(record, 'positionAuthority'), ['forced', 'voluntary'] as const),
  };
}

function parseVisualIntent(value: unknown, sampledAtMs: number): BrainVisualIntentDTO {
  const record = asRecord(value);
  requireExactKeys(
    record,
    ['episodeId', 'episodeStartedAtMs', 'kind', 'category', 'priority', 'interrupt', 'loop', 'emotionalTone'],
    ['expressionHint', 'gazeDirection', 'propHint']
  );
  const episodeStartedAtMs = finiteNumber(own(record, 'episodeStartedAtMs'), 0);
  if (episodeStartedAtMs > sampledAtMs) invalidContract();
  const expressionHint = Object.hasOwn(record, 'expressionHint')
    ? literal(own(record, 'expressionHint'), EXPRESSION_HINTS)
    : undefined;
  const gazeDirection = Object.hasOwn(record, 'gazeDirection')
    ? literal(own(record, 'gazeDirection'), ['left', 'right', 'up', 'down'] as const)
    : undefined;
  const propHint = Object.hasOwn(record, 'propHint')
    ? literal(own(record, 'propHint'), ['pillow', 'heart', 'question', 'sparkle', 'none'] as const)
    : undefined;
  return {
    episodeId: boundedId(own(record, 'episodeId')),
    episodeStartedAtMs,
    kind: literal(own(record, 'kind'), VISUAL_KINDS),
    category: literal(own(record, 'category'), VISUAL_CATEGORIES),
    priority: literal(own(record, 'priority'), ['low', 'normal', 'high', 'critical'] as const),
    interrupt: literal(own(record, 'interrupt'), ['yes', 'no', 'limited'] as const),
    loop: literal(own(record, 'loop'), ['none', 'until_replaced', 'bounded'] as const),
    emotionalTone: literal(own(record, 'emotionalTone'), EMOTIONAL_TONES),
    ...(expressionHint === undefined ? {} : { expressionHint }),
    ...(gazeDirection === undefined ? {} : { gazeDirection }),
    ...(propHint === undefined ? {} : { propHint }),
  };
}

export function parseBrainStateDTO(value: unknown): BrainStateDTO {
  const record = asRecord(value);
  requireExactKeys(record, [
    'streamId',
    'revision',
    'sampledAtMs',
    'character',
    'activity',
    'motion',
    'visualIntent',
  ]);
  const sampledAtMs = finiteNumber(own(record, 'sampledAtMs'), 0);
  const character = asRecord(own(record, 'character'));
  requireExactKeys(character, ['needs', 'synthesizedTone']);
  const needs = asRecord(own(character, 'needs'));
  requireExactKeys(needs, ['energy', 'attention', 'play', 'comfort', 'boredom']);
  return {
    streamId: boundedId(own(record, 'streamId')),
    revision: safeInteger(own(record, 'revision'), 1),
    sampledAtMs,
    character: {
      needs: {
        energy: finiteNumber(own(needs, 'energy'), 0, 100),
        attention: finiteNumber(own(needs, 'attention'), 0, 100),
        play: finiteNumber(own(needs, 'play'), 0, 100),
        comfort: finiteNumber(own(needs, 'comfort'), 0, 100),
        boredom: finiteNumber(own(needs, 'boredom'), 0, 100),
      },
      synthesizedTone: literal(own(character, 'synthesizedTone'), EMOTIONAL_TONES) as BrainEmotionalToneDTO,
    },
    activity: parseActivity(own(record, 'activity'), sampledAtMs),
    motion: parseMotion(own(record, 'motion')),
    visualIntent: parseVisualIntent(own(record, 'visualIntent'), sampledAtMs),
  };
}

function parseBodyMeta(record: Record<string, unknown>) {
  return {
    streamId: boundedId(own(record, 'streamId')),
    sequence: safeInteger(own(record, 'sequence'), 1),
    basedOnRevision: safeInteger(own(record, 'basedOnRevision'), 1),
    observedAtMs: finiteNumber(own(record, 'observedAtMs'), 0),
  };
}

export function parseBodyEventDTO(value: unknown): BodyEventDTO {
  const record = asRecord(value);
  const type = own(record, 'type');
  const metaKeys = ['streamId', 'sequence', 'basedOnRevision', 'observedAtMs', 'type'] as const;
  if (type === 'cursor_observed') {
    requireExactKeys(record, [...metaKeys, 'screenPosition']);
    return { ...parseBodyMeta(record), type, screenPosition: position(own(record, 'screenPosition')) };
  }
  if (type === 'interaction') {
    requireExactKeys(record, [...metaKeys, 'interaction'], ['intensity']);
    const intensity = Object.hasOwn(record, 'intensity')
      ? finiteNumber(own(record, 'intensity'), 0, 1)
      : undefined;
    return {
      ...parseBodyMeta(record),
      type,
      interaction: literal(
        own(record, 'interaction'),
        ['click', 'double_click', 'right_click', 'pet', 'play', 'feed', 'think'] as const
      ),
      ...(intensity === undefined ? {} : { intensity }),
    };
  }
  if (type === 'drag_started' || type === 'drag_moved') {
    requireExactKeys(record, [...metaKeys, 'gestureId', 'pointerId', 'screenPosition']);
    return {
      ...parseBodyMeta(record),
      type,
      gestureId: boundedId(own(record, 'gestureId')),
      pointerId: safeInteger(own(record, 'pointerId'), 0),
      screenPosition: position(own(record, 'screenPosition')),
    };
  }
  if (type === 'drag_ended') {
    requireExactKeys(record, [...metaKeys, 'gestureId', 'pointerId', 'screenPosition', 'cancelled']);
    const cancelled = own(record, 'cancelled');
    if (typeof cancelled !== 'boolean') invalidContract();
    return {
      ...parseBodyMeta(record),
      type,
      gestureId: boundedId(own(record, 'gestureId')),
      pointerId: safeInteger(own(record, 'pointerId'), 0),
      screenPosition: position(own(record, 'screenPosition')),
      cancelled,
    };
  }
  if (type === 'menu_visibility_changed') {
    requireExactKeys(record, [...metaKeys, 'expanded']);
    const expanded = own(record, 'expanded');
    if (typeof expanded !== 'boolean') invalidContract();
    return { ...parseBodyMeta(record), type, expanded };
  }
  invalidContract();
}
