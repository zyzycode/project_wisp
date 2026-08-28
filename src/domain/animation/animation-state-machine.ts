/**
 * Domain Model: Animation State Machine (FSM)
 * Pure domain logic for managing character animation states, transitions,
 * interruptibility, and timed cycles.
 */

import type { CharacterExpression } from '../models/character-visuals';

export type AnimationState =
  | 'idle'
  | 'float'
  | 'dragged'
  | 'falling'
  | 'landing'
  | 'sleep'
  | 'happy'
  | 'surprised'
  | 'thinking';

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
  durationMs?: number;
  autoNextState?: AnimationState;
  allowedTransitions: AnimationState[];
}

export const ANIMATION_STATES: Record<AnimationState, StateConfig> = {
  idle: {
    defaultExpression: 'idle',
    interruptible: true,
    allowedTransitions: ['float', 'dragged', 'sleep', 'happy', 'surprised', 'falling', 'thinking'],
  },
  float: {
    defaultExpression: 'idle',
    interruptible: true,
    allowedTransitions: ['idle', 'dragged', 'falling', 'happy', 'surprised', 'sleep', 'thinking'],
  },
  dragged: {
    defaultExpression: 'flying',
    interruptible: true,
    allowedTransitions: ['falling', 'landing', 'idle'],
  },
  falling: {
    defaultExpression: 'surprised',
    interruptible: true,
    allowedTransitions: ['landing', 'dragged', 'float', 'idle'],
  },
  landing: {
    defaultExpression: 'happy',
    interruptible: false,
    durationMs: 800,
    autoNextState: 'idle',
    allowedTransitions: ['idle', 'dragged'],
  },
  happy: {
    defaultExpression: 'happy',
    interruptible: false,
    durationMs: 1500,
    autoNextState: 'idle',
    allowedTransitions: ['idle', 'dragged', 'surprised', 'thinking', 'sleep'],
  },
  surprised: {
    defaultExpression: 'surprised',
    interruptible: false,
    durationMs: 1200,
    autoNextState: 'idle',
    allowedTransitions: ['idle', 'dragged', 'falling', 'thinking', 'happy', 'sleep'],
  },
  sleep: {
    defaultExpression: 'sleepy',
    interruptible: true,
    allowedTransitions: ['idle', 'dragged', 'surprised', 'happy', 'thinking'],
  },
  thinking: {
    defaultExpression: 'curious',
    interruptible: true,
    allowedTransitions: ['idle', 'happy', 'surprised', 'sleep', 'float', 'dragged', 'falling', 'thinking'],
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

  transition(event: AnimationEvent, force = false): boolean {
    const config = ANIMATION_STATES[this.currentState];
    if (!config) return false;

    // Check interruptibility if not forced
    if (!force && !config.interruptible && event !== 'START_DRAG') {
      return false;
    }

    let targetState: AnimationState | null = null;

    switch (event) {
      case 'START_DRAG':
        targetState = 'dragged';
        break;
      case 'RELEASE_DRAG':
        targetState = 'falling';
        break;
      case 'LAND':
        targetState = 'landing';
        break;
      case 'START_FLOAT':
        targetState = 'float';
        break;
      case 'STOP_FLOAT':
      case 'WAKE_UP':
      case 'SETTLE':
        targetState = 'idle';
        break;
      case 'START_SLEEP':
        targetState = 'sleep';
        break;
      case 'PET':
      case 'REACT_HAPPY':
        targetState = 'happy';
        break;
      case 'SPOOK':
      case 'REACT_CONFUSED':
        targetState = 'surprised';
        break;
      case 'THINK':
        targetState = 'thinking';
        break;
      default:
        break;
    }

    if (!targetState) {
      return false;
    }

    // Check if targetState is allowed from current state
    if (!force && !config.allowedTransitions.includes(targetState) && event !== 'START_DRAG') {
      return false;
    }

    this.currentState = targetState;
    this.currentExpression = ANIMATION_STATES[targetState]?.defaultExpression ?? 'idle';
    this.stateElapsedTimeMs = 0;
    this.notify();
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
