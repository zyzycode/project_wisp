/**
 * Domain Model: Animation State Machine (FSM)
 * Pure domain logic for managing character animation states, transitions,
 * interruptibility, and timed cycles.
 */

import type { CharacterExpression } from '../models/character-visuals';
import type { AnimationIntent, AnimationIntentKind, AnimationPriority } from './animation-intent';

export type AnimationState =
  | 'idle'
  | 'float'
  | 'dragged'
  | 'falling'
  | 'landing'
  | 'sleep'
  | 'happy'
  | 'surprised'
  | 'thinking'
  | 'spook'
  | 'sleep_start'
  | 'sleep_loop'
  | 'wake_up'
  | 'settle';

export type AnimationEvent =
  | 'START_DRAG'
  | 'RELEASE_DRAG'
  | 'LAND'
  | 'START_FLOAT'
  | 'STOP_FLOAT'
  | 'START_SLEEP'
  | 'WAKE_UP'
  | 'PET'
  | 'SPOOK'
  | 'THINK'
  | 'REACT_HAPPY'
  | 'REACT_CONFUSED'
  | 'SETTLE';

export interface StateConfig {
  defaultExpression: CharacterExpression;
  interruptible: boolean;
  priority: AnimationPriority;
  stable: boolean;
  durationMs?: number;
  autoNextState?: AnimationState;
  allowedTransitions: AnimationState[];
}

export const ANIMATION_STATES: Record<AnimationState, StateConfig> = {
  idle: {
    defaultExpression: 'idle',
    interruptible: true,
    priority: 'low',
    stable: true,
    allowedTransitions: ['float', 'dragged', 'sleep', 'sleep_start', 'happy', 'surprised', 'falling', 'thinking', 'spook'],
  },
  float: {
    defaultExpression: 'idle',
    interruptible: true,
    priority: 'normal',
    stable: false,
    allowedTransitions: ['settle', 'idle', 'dragged', 'falling', 'happy', 'surprised', 'sleep', 'sleep_start', 'thinking', 'spook'],
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
    interruptible: true,
    priority: 'normal',
    stable: false,
    allowedTransitions: ['landing', 'dragged', 'float', 'idle'],
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
  happy: {
    defaultExpression: 'happy',
    interruptible: false,
    priority: 'normal',
    stable: false,
    durationMs: 1500,
    autoNextState: 'idle',
    allowedTransitions: ['settle', 'idle', 'dragged', 'spook', 'surprised', 'thinking', 'sleep', 'sleep_start'],
  },
  surprised: {
    defaultExpression: 'surprised',
    interruptible: false,
    priority: 'normal',
    stable: false,
    durationMs: 1200,
    autoNextState: 'idle',
    allowedTransitions: ['settle', 'idle', 'dragged', 'spook', 'falling', 'thinking', 'happy', 'sleep', 'sleep_start'],
  },
  sleep: {
    defaultExpression: 'sleepy',
    interruptible: true,
    priority: 'high',
    stable: true,
    allowedTransitions: ['wake_up', 'idle', 'dragged', 'spook', 'sleep_start', 'sleep_loop'],
  },
  thinking: {
    defaultExpression: 'curious',
    interruptible: true,
    priority: 'normal',
    stable: false,
    durationMs: 2500,
    autoNextState: 'idle',
    allowedTransitions: ['settle', 'idle', 'happy', 'surprised', 'sleep', 'sleep_start', 'float', 'dragged', 'falling', 'thinking', 'spook'],
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
    allowedTransitions: ['idle', 'dragged', 'spook', 'sleep_start', 'sleep_loop', 'thinking', 'happy', 'surprised', 'float'],
  },
};

export type AnimationStateListener = (
  state: AnimationState,
  expression: CharacterExpression
) => void;

export class AnimationStateMachine {
  private currentState: AnimationState;
  private currentExpression: CharacterExpression;
  private stateElapsedTimeMs = 0;
  private listeners: Set<AnimationStateListener> = new Set();

  constructor(initialState: AnimationState = 'idle') {
    this.currentState = initialState;
    this.currentExpression = ANIMATION_STATES[initialState]?.defaultExpression ?? 'idle';
  }

  getCurrentState(): AnimationState {
    return this.currentState;
  }

  getCurrentExpression(): CharacterExpression {
    return this.currentExpression;
  }

  subscribe(listener: AnimationStateListener): () => void {
    this.listeners.add(listener);
    listener(this.currentState, this.currentExpression);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.currentState, this.currentExpression);
    }
  }

  private canTransitionTo(targetState: AnimationState, priority: AnimationPriority, force: boolean): boolean {
    const config = ANIMATION_STATES[this.currentState];

    if (force || priority === 'critical') {
      return config.allowedTransitions.includes(targetState) || targetState === 'dragged' || targetState === 'spook';
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

  private moveTo(targetState: AnimationState): void {
    this.currentState = targetState;
    this.currentExpression = ANIMATION_STATES[targetState]?.defaultExpression ?? 'idle';
    this.stateElapsedTimeMs = 0;
    this.notify();
  }

  transition(event: AnimationEvent, force = false): boolean {
    const config = ANIMATION_STATES[this.currentState];
    if (!config) return false;

    let targetState: AnimationState | null = null;
    let priority: AnimationPriority = 'normal';

    switch (event) {
      case 'START_DRAG':
        targetState = 'dragged';
        priority = 'critical';
        break;
      case 'RELEASE_DRAG':
        targetState = 'falling';
        priority = 'normal';
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
      default:
        break;
    }

    if (!targetState) {
      return false;
    }

    if (!this.canTransitionTo(targetState, priority, force)) {
      return false;
    }

    this.moveTo(targetState);
    return true;
  }

  applyIntent(intent: AnimationIntent, force = false): boolean {
    const targetState = animationIntentKindToState(intent.kind);

    if (!this.canTransitionTo(targetState, intent.priority, force)) {
      return false;
    }

    this.moveTo(targetState);
    return true;
  }

  update(deltaTimeMs: number): void {
    this.stateElapsedTimeMs += deltaTimeMs;
    const config = ANIMATION_STATES[this.currentState];

    if (config?.durationMs && config.autoNextState) {
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

function priorityValue(priority: AnimationPriority): number {
  switch (priority) {
    case 'low':
      return 0;
    case 'normal':
      return 1;
    case 'high':
      return 2;
    case 'critical':
      return 3;
  }
}

function animationIntentKindToState(kind: AnimationIntentKind): AnimationState {
  switch (kind) {
    case 'idle_blink':
      return 'idle';
    case 'thinking_loop':
      return 'thinking';
    case 'talking':
      return 'thinking';
    case 'happy_reaction':
      return 'happy';
    case 'confused_reaction':
      return 'surprised';
    case 'sleep_start':
      return 'sleep_start';
    case 'sleep_loop':
      return 'sleep_loop';
    case 'wake_up':
      return 'wake_up';
    case 'land':
      return 'landing';
    case 'walk':
      return 'float';
    case 'dragged':
      return 'dragged';
    case 'spook':
      return 'spook';
    case 'settle':
      return 'idle';
  }
}
