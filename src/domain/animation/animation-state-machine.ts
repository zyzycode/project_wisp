import type { CharacterExpression } from '../models/character-visuals';
import type { AnimationIntent, AnimationPriority } from './animation-intent';

export type CoreAnimationState =
  | 'idle'
  | 'settle'
  | 'float'
  | 'dragged'
  | 'falling'
  | 'landing'
  | 'sleep_start'
  | 'sleep_loop'
  | 'wake_up'
  | 'thinking'
  | 'happy'
  | 'surprised'
  | 'bored'
  | 'wave'
  | 'celebrate'
  | 'spook'
  | 'sleep';

export type LocomotionAnimationState =
  | 'sit'
  | 'stand_up'
  | 'lie_down'
  | 'get_up'
  | 'run'
  | 'jump'
  | 'fall'
  | 'land'
  | 'crawl'
  | 'climb_wall'
  | 'hang_ceiling';

export type AnimationState = CoreAnimationState;
export type AnyAnimationState = CoreAnimationState | LocomotionAnimationState;

export type CoreAnimationEvent =
  | 'TICK'
  | 'START_FLOAT'
  | 'STOP_FLOAT'
  | 'START_DRAG'
  | 'RELEASE_DRAG'
  | 'START_SLEEP'
  | 'WAKE_UP'
  | 'REACT_HAPPY'
  | 'REACT_CONFUSED'
  | 'THINK'
  | 'BORED'
  | 'WAVE'
  | 'CELEBRATE'
  | 'SPOOK'
  | 'SETTLE'
  | 'PET'
  | 'LAND';

export type LocomotionAnimationEvent =
  | 'SIT'
  | 'STAND_UP'
  | 'LIE_DOWN'
  | 'GET_UP'
  | 'RUN'
  | 'JUMP'
  | 'FALL'
  | 'CRAWL'
  | 'CLIMB_WALL'
  | 'HANG_CEILING';

export type AnimationEvent = CoreAnimationEvent | LocomotionAnimationEvent;

export interface StateConfig {
  defaultExpression: CharacterExpression;
  interruptible: boolean;
  priority: AnimationPriority;
  stable: boolean;
  durationMs?: number;
  autoNextState?: AnyAnimationState;
  allowedTransitions: AnyAnimationState[];
}

export const ANIMATION_STATES: Record<AnyAnimationState, StateConfig> = {
  idle: {
    defaultExpression: 'idle',
    interruptible: true,
    priority: 'low',
    stable: true,
    allowedTransitions: [
      'settle',
      'float',
      'dragged',
      'spook',
      'happy',
      'surprised',
      'thinking',
      'sleep',
      'sleep_start',
      'wave',
      'celebrate',
      'bored',
      'sit',
      'stand_up',
      'lie_down',
      'get_up',
      'run',
      'jump',
      'crawl',
      'climb_wall',
      'hang_ceiling',
    ],
  },
  float: {
    defaultExpression: 'idle',
    interruptible: true,
    priority: 'normal',
    stable: true,
    allowedTransitions: [
      'settle',
      'idle',
      'dragged',
      'spook',
      'happy',
      'thinking',
      'sleep_start',
      'wave',
      'celebrate',
      'bored',
      'sit',
      'run',
      'jump',
      'crawl',
      'climb_wall',
      'hang_ceiling',
    ],
  },
  dragged: {
    defaultExpression: 'flying',
    interruptible: false,
    priority: 'critical',
    stable: true,
    allowedTransitions: ['falling', 'landing', 'idle', 'spook'],
  },
  falling: {
    defaultExpression: 'surprised',
    interruptible: false,
    priority: 'critical',
    stable: true,
    allowedTransitions: ['landing', 'dragged', 'spook', 'fall'],
  },
  landing: {
    defaultExpression: 'happy',
    interruptible: false,
    priority: 'high',
    stable: false,
    durationMs: 800,
    autoNextState: 'idle',
    allowedTransitions: ['settle', 'idle', 'dragged', 'spook'],
  },
  sleep: {
    defaultExpression: 'sleepy',
    interruptible: true,
    priority: 'high',
    stable: false,
    durationMs: 0,
    autoNextState: 'sleep_start',
    allowedTransitions: ['sleep_start', 'wake_up', 'dragged', 'spook', 'idle'],
  },
  happy: {
    defaultExpression: 'happy',
    interruptible: true,
    priority: 'normal',
    stable: false,
    durationMs: 1500,
    autoNextState: 'idle',
    allowedTransitions: [
      'settle',
      'idle',
      'dragged',
      'spook',
      'happy',
      'thinking',
      'sleep',
      'sleep_start',
      'wave',
      'celebrate',
      'bored',
      'sit',
      'run',
      'crawl',
    ],
  },
  surprised: {
    defaultExpression: 'surprised',
    interruptible: true,
    priority: 'normal',
    stable: false,
    durationMs: 1200,
    autoNextState: 'idle',
    allowedTransitions: [
      'settle',
      'idle',
      'dragged',
      'spook',
      'thinking',
      'happy',
      'sleep',
      'sleep_start',
      'bored',
    ],
  },
  thinking: {
    defaultExpression: 'curious',
    interruptible: true,
    priority: 'normal',
    stable: false,
    durationMs: 4000,
    autoNextState: 'idle',
    allowedTransitions: [
      'settle',
      'idle',
      'dragged',
      'spook',
      'happy',
      'surprised',
      'sleep',
      'sleep_start',
      'wave',
      'celebrate',
      'bored',
    ],
  },
  spook: {
    defaultExpression: 'surprised',
    interruptible: false,
    priority: 'critical',
    stable: false,
    durationMs: 900,
    autoNextState: 'idle',
    allowedTransitions: ['settle', 'idle', 'dragged'],
  },
  wave: {
    defaultExpression: 'happy',
    interruptible: true,
    priority: 'normal',
    stable: false,
    durationMs: 2000,
    autoNextState: 'idle',
    allowedTransitions: [
      'settle',
      'idle',
      'dragged',
      'spook',
      'happy',
      'thinking',
      'sleep',
      'sleep_start',
      'celebrate',
      'bored',
    ],
  },
  celebrate: {
    defaultExpression: 'happy',
    interruptible: true,
    priority: 'normal',
    stable: false,
    durationMs: 2500,
    autoNextState: 'idle',
    allowedTransitions: [
      'settle',
      'idle',
      'dragged',
      'spook',
      'happy',
      'thinking',
      'sleep',
      'sleep_start',
      'wave',
      'bored',
      'celebrate',
    ],
  },
  bored: {
    defaultExpression: 'curious',
    interruptible: true,
    priority: 'normal',
    stable: false,
    durationMs: 3000,
    autoNextState: 'idle',
    allowedTransitions: [
      'settle',
      'idle',
      'dragged',
      'spook',
      'happy',
      'thinking',
      'sleep',
      'sleep_start',
      'wave',
      'celebrate',
      'bored',
      'sit',
      'lie_down',
      'run',
      'jump',
      'crawl',
    ],
  },
  sleep_start: {
    defaultExpression: 'sleepy',
    interruptible: false,
    priority: 'high',
    stable: false,
    durationMs: 1000,
    autoNextState: 'sleep_loop',
    allowedTransitions: ['sleep_loop', 'wake_up', 'dragged', 'spook'],
  },
  sleep_loop: {
    defaultExpression: 'sleepy',
    interruptible: false,
    priority: 'high',
    stable: true,
    allowedTransitions: ['wake_up', 'dragged', 'spook', 'sleep_start'],
  },
  wake_up: {
    defaultExpression: 'sleepy',
    interruptible: false,
    priority: 'high',
    stable: false,
    durationMs: 900,
    autoNextState: 'idle',
    allowedTransitions: ['settle', 'idle', 'dragged', 'spook', 'sleep_start'],
  },
  settle: {
    defaultExpression: 'idle',
    interruptible: true,
    priority: 'low',
    stable: false,
    durationMs: 0,
    autoNextState: 'idle',
    allowedTransitions: [
      'idle',
      'dragged',
      'spook',
      'sleep_start',
      'sleep_loop',
      'thinking',
      'happy',
      'surprised',
      'float',
      'wave',
      'celebrate',
      'bored',
      'sit',
      'lie_down',
      'run',
      'jump',
      'crawl',
    ],
  },
  sit: {
    defaultExpression: 'idle',
    interruptible: true,
    priority: 'low',
    stable: true,
    allowedTransitions: [
      'idle',
      'stand_up',
      'lie_down',
      'dragged',
      'spook',
      'happy',
      'run',
      'crawl',
    ],
  },
  stand_up: {
    defaultExpression: 'idle',
    interruptible: false,
    priority: 'normal',
    stable: false,
    durationMs: 800,
    autoNextState: 'idle',
    allowedTransitions: ['idle', 'float', 'dragged', 'spook', 'run', 'jump', 'crawl'],
  },
  lie_down: {
    defaultExpression: 'sleepy',
    interruptible: true,
    priority: 'low',
    stable: true,
    allowedTransitions: ['get_up', 'sleep_start', 'dragged', 'spook', 'idle'],
  },
  get_up: {
    defaultExpression: 'idle',
    interruptible: false,
    priority: 'normal',
    stable: false,
    durationMs: 800,
    autoNextState: 'idle',
    allowedTransitions: ['idle', 'sit', 'stand_up', 'dragged', 'spook', 'run', 'crawl'],
  },
  run: {
    defaultExpression: 'happy',
    interruptible: true,
    priority: 'normal',
    stable: false,
    durationMs: 2000,
    autoNextState: 'idle',
    allowedTransitions: ['idle', 'float', 'jump', 'dragged', 'spook', 'falling', 'fall', 'crawl', 'sit'],
  },
  jump: {
    defaultExpression: 'happy',
    interruptible: false,
    priority: 'normal',
    stable: false,
    durationMs: 600,
    autoNextState: 'fall',
    allowedTransitions: ['fall', 'falling', 'landing', 'land', 'dragged', 'spook'],
  },
  fall: {
    defaultExpression: 'surprised',
    interruptible: false,
    priority: 'high',
    stable: true,
    allowedTransitions: ['landing', 'land', 'dragged', 'spook'],
  },
  land: {
    defaultExpression: 'happy',
    interruptible: false,
    priority: 'high',
    stable: false,
    durationMs: 800,
    autoNextState: 'idle',
    allowedTransitions: ['idle', 'settle', 'dragged', 'spook'],
  },
  crawl: {
    defaultExpression: 'idle',
    interruptible: true,
    priority: 'normal',
    stable: false,
    durationMs: 2500,
    autoNextState: 'idle',
    allowedTransitions: ['idle', 'settle', 'sit', 'stand_up', 'dragged', 'spook', 'run', 'fall', 'falling'],
  },
  climb_wall: {
    defaultExpression: 'curious',
    interruptible: true,
    priority: 'normal',
    stable: true,
    allowedTransitions: ['idle', 'settle', 'dragged', 'spook', 'fall', 'falling', 'hang_ceiling'],
  },
  hang_ceiling: {
    defaultExpression: 'curious',
    interruptible: true,
    priority: 'normal',
    stable: true,
    allowedTransitions: ['idle', 'settle', 'dragged', 'spook', 'fall', 'falling', 'climb_wall'],
  },
};

export type AnimationStateListener<TState extends string = AnimationState> = (
  state: TState,
  expression: CharacterExpression
) => void;

function priorityValue(priority: AnimationPriority): number {
  switch (priority) {
    case 'low': return 0;
    case 'normal': return 1;
    case 'high': return 2;
    case 'critical': return 3;
  }
}

export class AnimationStateMachine<TState extends string = AnimationState> {
  private currentState: AnyAnimationState;
  private currentExpression: CharacterExpression;
  private stateElapsedTimeMs = 0;
  private isStateLocked = false;
  private listeners: Set<AnimationStateListener<TState>> = new Set();

  constructor(initialState: AnyAnimationState = 'idle') {
    this.currentState = initialState;
    this.currentExpression = ANIMATION_STATES[initialState]?.defaultExpression ?? 'idle';
  }

  getCurrentState(): TState {
    return this.currentState as TState;
  }

  getCurrentExpression(): CharacterExpression {
    return this.currentExpression;
  }

  subscribe(listener: AnimationStateListener<TState>): () => void {
    this.listeners.add(listener);
    listener(this.currentState as TState, this.currentExpression);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.currentState as TState, this.currentExpression);
    }
  }

  private canTransitionTo(targetState: AnyAnimationState, priority: AnimationPriority, force: boolean): boolean {
    if (force) {
      return true;
    }

    const config = ANIMATION_STATES[this.currentState];
    if (!config) return true;

    if (priority === 'critical') {
      return (
        config.allowedTransitions.includes(targetState) ||
        targetState === 'dragged' ||
        targetState === 'spook' ||
        targetState === 'falling' ||
        targetState === 'fall' ||
        targetState === 'landing' ||
        targetState === 'land'
      );
    }

    if (!config.interruptible) {
      if (
        config.priority === 'critical' &&
        (targetState === 'falling' || targetState === 'landing' || targetState === 'idle')
      ) {
        return config.allowedTransitions.includes(targetState);
      }

      return config.allowedTransitions.includes(targetState) && priorityValue(priority) >= priorityValue(config.priority);
    }

    if (config.priority === 'high' && priorityValue(priority) < priorityValue('high')) {
      return false;
    }

    if (priority === 'low' && priorityValue(config.priority) >= priorityValue('normal')) {
      return false;
    }

    if (config.stable && this.currentState === 'sleep_loop') {
      return targetState === 'wake_up' || targetState === 'dragged' || targetState === 'spook' || targetState === 'sleep_start';
    }

    return config.allowedTransitions.includes(targetState);
  }

  private moveTo(targetState: AnyAnimationState): void {
    this.currentState = targetState;
    this.currentExpression = ANIMATION_STATES[targetState]?.defaultExpression ?? 'idle';
    this.stateElapsedTimeMs = 0;
    this.notify();
  }

  transition(event: AnimationEvent, force = false, loop = false): boolean {
    const config = ANIMATION_STATES[this.currentState];
    if (!config) return false;

    let targetState: AnyAnimationState | null = null;
    let priority: AnimationPriority = 'normal';

    switch (event) {
      case 'START_DRAG':
        targetState = 'dragged';
        priority = 'critical';
        break;
      case 'RELEASE_DRAG':
        targetState = 'falling';
        priority = 'critical';
        break;
      case 'LAND':
        targetState = 'landing';
        priority = 'high';
        break;
      case 'START_FLOAT':
        targetState = 'float';
        priority = 'normal';
        break;
      case 'STOP_FLOAT':
      case 'SETTLE':
        targetState = 'idle';
        priority = 'normal';
        break;
      case 'WAKE_UP':
        targetState = 'wake_up';
        priority = 'high';
        break;
      case 'START_SLEEP':
        targetState = 'sleep_start';
        priority = 'high';
        break;
      case 'PET':
      case 'REACT_HAPPY':
        targetState = 'happy';
        priority = 'normal';
        break;
      case 'SPOOK':
        targetState = 'spook';
        priority = 'critical';
        break;
      case 'REACT_CONFUSED':
        targetState = 'surprised';
        priority = 'normal';
        break;
      case 'THINK':
        targetState = 'thinking';
        priority = 'normal';
        break;
      case 'WAVE':
        targetState = 'wave';
        priority = 'normal';
        break;
      case 'CELEBRATE':
        targetState = 'celebrate';
        priority = 'normal';
        break;
      case 'BORED':
        targetState = 'bored';
        priority = 'normal';
        break;
      case 'SIT':
        targetState = 'sit';
        priority = 'normal';
        break;
      case 'STAND_UP':
        targetState = 'stand_up';
        priority = 'normal';
        break;
      case 'LIE_DOWN':
        targetState = 'lie_down';
        priority = 'normal';
        break;
      case 'GET_UP':
        targetState = 'get_up';
        priority = 'normal';
        break;
      case 'RUN':
        targetState = 'run';
        priority = 'normal';
        break;
      case 'JUMP':
        targetState = 'jump';
        priority = 'normal';
        break;
      case 'FALL':
        targetState = 'fall';
        priority = 'critical';
        break;
      case 'CRAWL':
        targetState = 'crawl';
        priority = 'normal';
        break;
      case 'CLIMB_WALL':
        targetState = 'climb_wall';
        priority = 'normal';
        break;
      case 'HANG_CEILING':
        targetState = 'hang_ceiling';
        priority = 'normal';
        break;
      default:
        break;
    }

    if (!targetState) {
      return false;
    }

    if (!this.canTransitionTo(targetState, priority, force)) {
      return false;
    }

    this.isStateLocked = loop;
    this.moveTo(targetState);
    return true;
  }

  applyIntent(intent: AnimationIntent<any>, force = false, loop = false): boolean {
    const targetState = this.animationIntentKindToState(intent.kind);

    if (!this.canTransitionTo(targetState, intent.priority, force)) {
      return false;
    }

    this.isStateLocked = loop;
    this.moveTo(targetState);
    return true;
  }

  private animationIntentKindToState(kind: string): AnyAnimationState {
    switch (kind) {
      case 'idle_blink':
      case 'settle':
        return 'idle';
      case 'walk':
        return 'float';
      case 'dragged':
        return 'dragged';
      case 'land':
        return 'landing';
      case 'happy_reaction':
        return 'happy';
      case 'confused_reaction':
        return 'surprised';
      case 'thinking_loop':
      case 'talking':
        return 'thinking';
      case 'spook':
        return 'spook';
      case 'wave':
        return 'wave';
      case 'celebrate':
        return 'celebrate';
      case 'bored':
        return 'bored';
      case 'sleep_start':
        return 'sleep_start';
      case 'sleep_loop':
        return 'sleep_loop';
      case 'wake_up':
        return 'wake_up';
      case 'sit':
        return 'sit';
      case 'stand_up':
        return 'stand_up';
      case 'lie_down':
        return 'lie_down';
      case 'get_up':
        return 'get_up';
      case 'run':
        return 'run';
      case 'jump':
        return 'jump';
      case 'fall':
        return 'fall';
      case 'crawl':
        return 'crawl';
      case 'climb_wall':
        return 'climb_wall';
      case 'hang_ceiling':
        return 'hang_ceiling';
      default:
        return 'idle';
    }
  }

  update(deltaTimeMs: number): void {
    this.stateElapsedTimeMs += deltaTimeMs;
    const config = ANIMATION_STATES[this.currentState];

    if (!this.isStateLocked && config?.durationMs && config.autoNextState) {
      if (this.stateElapsedTimeMs >= config.durationMs) {
        this.currentState = config.autoNextState;
        this.currentExpression =
          ANIMATION_STATES[this.currentState]?.defaultExpression ?? 'idle';
        this.stateElapsedTimeMs = 0;
        this.notify();
      }
    }
  }
}
