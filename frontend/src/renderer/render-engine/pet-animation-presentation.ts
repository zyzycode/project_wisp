import type {
  AnimationEvent,
  AnyAnimationState,
  TerminalAnimationState,
} from '../../domain/animation/animation-state-machine';
import type {
  AnimationExpressionHint,
  AnimationIntentKind,
} from '../../domain/animation/animation-intent';

export function animationStateToIntentKind(state: AnyAnimationState): AnimationIntentKind {
  const mapping: Partial<Record<AnyAnimationState, AnimationIntentKind>> = {
    float: 'walk', dragged: 'dragged', falling: 'fall', fall: 'fall', landing: 'land',
    land: 'land', sleep: 'sleep_loop', sleep_loop: 'sleep_loop', sleep_start: 'sleep_start',
    wake_up: 'wake_up', happy: 'happy_reaction', surprised: 'confused_reaction',
    thinking: 'thinking_loop', spook: 'spook', wave: 'wave', celebrate: 'celebrate',
    bored: 'bored', settle: 'settle', sit: 'sit', stand_up: 'stand_up', lie_down: 'lie_down',
    get_up: 'get_up', run: 'run', jump: 'jump', crawl: 'crawl', climb_wall: 'climb_wall',
    hang_ceiling: 'hang_ceiling', idle: 'idle_blink',
  };
  return mapping[state] ?? 'idle_blink';
}

export function localTerminalKind(kind: AnimationIntentKind): AnimationIntentKind | null {
  if (kind === 'sleep_start') return 'sleep_loop';
  if (kind === 'land' || kind === 'crash_landing') return 'settle';
  if (['wake_up', 'happy_reaction', 'confused_reaction', 'talking', 'spook'].includes(kind)) {
    return 'idle_blink';
  }
  return null;
}

export function synchronizeLocalAnimationState(
  kind: AnimationIntentKind,
  dispatch: (event: AnimationEvent, force?: boolean, loop?: boolean) => boolean,
  synchronizeTerminal: (state: TerminalAnimationState) => boolean
): void {
  if (kind === 'idle_blink' || kind === 'settle' || kind === 'sleep_loop') {
    synchronizeTerminal(kind === 'idle_blink' ? 'idle' : kind);
    return;
  }
  const events: Partial<Record<AnimationIntentKind, AnimationEvent>> = {
    grab_edge: 'CLIMB_WALL', jump_travel: 'JUMP', pull_up_edge: 'LAND',
    sit_edge_settle: 'SIT', sit_edge_sleep: 'START_SLEEP', cursor_play: 'WAVE',
    walk: 'START_FLOAT', sleep_start: 'START_SLEEP', wake_up: 'WAKE_UP',
    happy_reaction: 'REACT_HAPPY', confused_reaction: 'REACT_CONFUSED',
    thinking_loop: 'THINK', bored: 'BORED', wave: 'WAVE', celebrate: 'CELEBRATE',
    spook: 'SPOOK', dragged: 'START_DRAG', land: 'LAND', sit: 'SIT', sit_edge: 'SIT',
    stand_up: 'STAND_UP', lie_down: 'LIE_DOWN', get_up: 'GET_UP', run: 'RUN',
    jump: 'JUMP', fall: 'FALL', crawl: 'CRAWL', climb_wall: 'CLIMB_WALL',
    hang_ceiling: 'HANG_CEILING',
  };
  const event = events[kind];
  if (event !== undefined) dispatch(event, true, kind.endsWith('_loop'));
}

export function expressionToHint(expression: string): AnimationExpressionHint {
  if (expression === 'happy') return 'happy';
  if (expression === 'sleepy') return 'sleepy';
  if (expression === 'surprised' || expression === 'flying') return 'surprised';
  if (expression === 'curious') return 'curious';
  return 'idle';
}
