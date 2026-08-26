import { describe, it, expect, vi } from 'vitest';
import {
  AnimationStateMachine,
  ANIMATION_STATES,
} from '../../src/domain/animation/animation-state-machine';

describe('Domain: AnimationStateMachine', () => {
  it('initializes in idle state with idle expression', () => {
    const fsm = new AnimationStateMachine();
    expect(fsm.getCurrentState()).toBe('idle');
    expect(fsm.getCurrentExpression()).toBe('idle');
  });

  it('transitions properly on valid events', () => {
    const fsm = new AnimationStateMachine('idle');

    // Idle -> START_DRAG -> Dragged (expression: flying)
    expect(fsm.transition('START_DRAG')).toBe(true);
    expect(fsm.getCurrentState()).toBe('dragged');
    expect(fsm.getCurrentExpression()).toBe('flying');

    // Dragged -> RELEASE_DRAG -> Falling (expression: surprised)
    expect(fsm.transition('RELEASE_DRAG')).toBe(true);
    expect(fsm.getCurrentState()).toBe('falling');
    expect(fsm.getCurrentExpression()).toBe('surprised');

    // Falling -> LAND -> Landing (expression: happy)
    expect(fsm.transition('LAND')).toBe(true);
    expect(fsm.getCurrentState()).toBe('landing');
    expect(fsm.getCurrentExpression()).toBe('happy');
  });

  it('handles timed state transitions automatically on update', () => {
    const fsm = new AnimationStateMachine('landing');
    expect(fsm.getCurrentState()).toBe('landing');

    // Landing duration is 800ms
    fsm.update(500);
    expect(fsm.getCurrentState()).toBe('landing');

    fsm.update(350); // total 850ms >= 800ms
    expect(fsm.getCurrentState()).toBe('idle');
    expect(fsm.getCurrentExpression()).toBe('idle');
  });

  it('blocks non-allowed transitions from current state', () => {
    const fsm = new AnimationStateMachine('dragged');

    // Dragged cannot directly transition to sleep
    expect(fsm.transition('START_SLEEP')).toBe(false);
    expect(fsm.getCurrentState()).toBe('dragged');
  });

  it('always allows emergency START_DRAG even from non-interruptible states', () => {
    const fsm = new AnimationStateMachine('landing');
    expect(ANIMATION_STATES.landing?.interruptible).toBe(false);

    // User grabs pet during landing -> must immediately become dragged
    expect(fsm.transition('START_DRAG')).toBe(true);
    expect(fsm.getCurrentState()).toBe('dragged');
  });

  it('notifies subscribers on state changes', () => {
    const fsm = new AnimationStateMachine('idle');
    const listener = vi.fn();

    const unsubscribe = fsm.subscribe(listener);
    expect(listener).toHaveBeenCalledWith('idle', 'idle');

    fsm.transition('PET');
    expect(listener).toHaveBeenCalledWith('happy', 'happy');

    unsubscribe();
    fsm.transition('START_DRAG');
    expect(listener).toHaveBeenCalledTimes(2); // not called again after unsubscribe
  });
});
