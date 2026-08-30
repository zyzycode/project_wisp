import { describe, it, expect, vi } from 'vitest';
import {
  AnimationStateMachine,
  ANIMATION_STATES,
  createSystemAnimationIntent,
  mapBehaviorIntentToAnimationIntent,
} from '../../src/domain/animation';
import type { BehaviorIntent } from '../../src/domain/behavior/behavior-intent';

function behaviorIntent(overrides: Partial<BehaviorIntent>): BehaviorIntent {
  return {
    kind: 'idle',
    source: 'user',
    priority: 'normal',
    ...overrides,
  };
}

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

    // Dragged -> RELEASE_DRAG -> falling (expression: surprised)
    expect(fsm.transition('RELEASE_DRAG')).toBe(true);
    expect(fsm.getCurrentState()).toBe('falling');
    expect(fsm.getCurrentExpression()).toBe('surprised');

    // Falling -> LAND -> landing (expression: happy)
    expect(fsm.transition('LAND')).toBe(true);
    expect(fsm.getCurrentState()).toBe('landing');
    expect(fsm.getCurrentExpression()).toBe('happy');
  });

  it('transitions properly into thinking state and reacts to dialogue responses', () => {
    const fsm = new AnimationStateMachine('idle');

    // Idle -> THINK -> thinking (expression: curious)
    expect(fsm.transition('THINK')).toBe(true);
    expect(fsm.getCurrentState()).toBe('thinking');
    expect(fsm.getCurrentExpression()).toBe('curious');

    // Thinking -> REACT_HAPPY -> happy (expression: happy)
    expect(fsm.transition('REACT_HAPPY')).toBe(true);
    expect(fsm.getCurrentState()).toBe('happy');
    expect(fsm.getCurrentExpression()).toBe('happy');

    // Happy -> idle directly after bounded reaction completes
    fsm.update(1600);
    expect(fsm.getCurrentState()).toBe('idle');
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

  it('runs sleep lifecycle through protected sleep_start and stable sleep_loop', () => {
    const fsm = new AnimationStateMachine('idle');

    expect(fsm.transition('START_SLEEP')).toBe(true);
    expect(fsm.getCurrentState()).toBe('sleep_start');
    expect(fsm.transition('REACT_HAPPY')).toBe(false);
    expect(fsm.getCurrentState()).toBe('sleep_start');

    fsm.update(1000);
    expect(fsm.getCurrentState()).toBe('sleep_loop');
    expect(fsm.transition('SETTLE')).toBe(false);
    expect(fsm.transition('THINK')).toBe(false);
    expect(fsm.transition('START_FLOAT')).toBe(false);
    expect(fsm.getCurrentState()).toBe('sleep_loop');
  });

  it('allows wake_up and drag to replace protected sleep_loop', () => {
    const wakeFsm = new AnimationStateMachine('sleep_loop');

    expect(wakeFsm.transition('WAKE_UP')).toBe(true);
    expect(wakeFsm.getCurrentState()).toBe('wake_up');
    expect(wakeFsm.transition('REACT_CONFUSED')).toBe(false);

    wakeFsm.update(900);
    expect(wakeFsm.getCurrentState()).toBe('idle');

    const dragFsm = new AnimationStateMachine('sleep_loop');
    expect(dragFsm.transition('START_DRAG')).toBe(true);
    expect(dragFsm.getCurrentState()).toBe('dragged');
  });

  it('applies AnimationIntent with priority protection', () => {
    const fsm = new AnimationStateMachine('sleep_loop');
    const lowIdle = createSystemAnimationIntent('idle_blink', 'neutral');
    const normalTalk = mapBehaviorIntentToAnimationIntent(
      behaviorIntent({ kind: 'respond', source: 'provider' }),
      'neutral'
    );
    const wake = mapBehaviorIntentToAnimationIntent(behaviorIntent({ kind: 'wake' }), 'sleepy');

    expect(fsm.applyIntent(lowIdle)).toBe(false);
    expect(fsm.applyIntent(normalTalk)).toBe(false);
    expect(fsm.applyIntent(wake)).toBe(true);
    expect(fsm.getCurrentState()).toBe('wake_up');
  });

  it('does not let low-priority idle or settle intents cancel active dialogue', () => {
    const fsm = new AnimationStateMachine('thinking');

    expect(fsm.applyIntent(createSystemAnimationIntent('idle_blink', 'neutral'))).toBe(false);
    expect(fsm.applyIntent(createSystemAnimationIntent('settle', 'neutral'))).toBe(false);
    expect(fsm.getCurrentState()).toBe('thinking');
  });

  it('lets critical spook interrupt any state and settle directly to idle afterward', () => {
    const fsm = new AnimationStateMachine('sleep_start');
    const spook = createSystemAnimationIntent('spook', 'neutral');

    expect(fsm.applyIntent(spook)).toBe(true);
    expect(fsm.getCurrentState()).toBe('spook');
    expect(fsm.getCurrentExpression()).toBe('surprised');

    fsm.update(900);
    expect(fsm.getCurrentState()).toBe('idle');
  });

  it('force unconditionally interrupts any active state and can lock looping indefinitely', () => {
    const fsm = new AnimationStateMachine('sleep_start');

    // Force transition to happy with loop = true
    expect(fsm.transition('PET', true, true)).toBe(true);
    expect(fsm.getCurrentState()).toBe('happy');

    // Advancing time far beyond duration (e.g. 5000ms) does NOT reset to idle because loop is locked
    fsm.update(5000);
    expect(fsm.getCurrentState()).toBe('happy');

    // Force transition to thinking immediately interrupts happy
    expect(fsm.transition('THINK', true, true)).toBe(true);
    expect(fsm.getCurrentState()).toBe('thinking');

    // SETTLE unlocks loop and resets to idle
    expect(fsm.transition('SETTLE', true, false)).toBe(true);
    expect(fsm.getCurrentState()).toBe('idle');
  });

  describe('FSM Locomotion Expansion', () => {
    it('supports sit and stand_up lifecycle', () => {
      const fsm = new AnimationStateMachine('idle');

      expect(fsm.transition('SIT')).toBe(true);
      expect(fsm.getCurrentState()).toBe('sit');
      expect(fsm.getCurrentExpression()).toBe('idle');

      expect(fsm.transition('STAND_UP')).toBe(true);
      expect(fsm.getCurrentState()).toBe('stand_up');
      fsm.update(800);
      expect(fsm.getCurrentState()).toBe('idle');
    });

    it('supports lie_down and get_up lifecycle', () => {
      const fsm = new AnimationStateMachine('idle');

      expect(fsm.transition('LIE_DOWN')).toBe(true);
      expect(fsm.getCurrentState()).toBe('lie_down');
      expect(fsm.getCurrentExpression()).toBe('sleepy');

      expect(fsm.transition('GET_UP')).toBe(true);
      expect(fsm.getCurrentState()).toBe('get_up');
      fsm.update(900);
      expect(fsm.getCurrentState()).toBe('idle');
    });

    it('supports run locomotion', () => {
      const fsm = new AnimationStateMachine('idle');

      expect(fsm.transition('RUN')).toBe(true);
      expect(fsm.getCurrentState()).toBe('run');
      expect(fsm.getCurrentExpression()).toBe('happy');
      fsm.update(2000);
      expect(fsm.getCurrentState()).toBe('idle');
    });

    it('supports jump -> fall -> land sequence', () => {
      const fsm = new AnimationStateMachine('idle');

      expect(fsm.transition('JUMP')).toBe(true);
      expect(fsm.getCurrentState()).toBe('jump');
      expect(fsm.getCurrentExpression()).toBe('happy');

      // Jump automatically progresses to fall after duration
      fsm.update(600);
      expect(fsm.getCurrentState()).toBe('fall');

      // Fall lands
      expect(fsm.transition('LAND')).toBe(true);
      expect(fsm.getCurrentState()).toBe('landing');
      fsm.update(800);
      expect(fsm.getCurrentState()).toBe('idle');
    });

    it('supports crawl locomotion', () => {
      const fsm = new AnimationStateMachine('idle');

      expect(fsm.transition('CRAWL')).toBe(true);
      expect(fsm.getCurrentState()).toBe('crawl');
      expect(fsm.getCurrentExpression()).toBe('idle');
      fsm.update(2500);
      expect(fsm.getCurrentState()).toBe('idle');
    });

    it('supports wall climbing and ceiling hanging, while P0 fall and P1 drag interrupt both', () => {
      const climb = new AnimationStateMachine('idle');
      expect(climb.transition('CLIMB_WALL')).toBe(true);
      expect(climb.getCurrentState()).toBe('climb_wall');
      expect(climb.transition('FALL')).toBe(true);
      expect(climb.getCurrentState()).toBe('fall');

      const hang = new AnimationStateMachine('idle');
      expect(hang.transition('HANG_CEILING')).toBe(true);
      expect(hang.getCurrentState()).toBe('hang_ceiling');
      expect(hang.transition('START_DRAG')).toBe(true);
      expect(hang.getCurrentState()).toBe('dragged');

      const crawl = new AnimationStateMachine('idle');
      expect(crawl.transition('CRAWL')).toBe(true);
      expect(crawl.transition('FALL')).toBe(true);
      expect(crawl.getCurrentState()).toBe('fall');
    });

    it('applies locomotion animation intents correctly', () => {
      const fsm = new AnimationStateMachine('idle');
      const sitIntent = createSystemAnimationIntent('sit', 'neutral');
      expect(fsm.applyIntent(sitIntent)).toBe(true);
      expect(fsm.getCurrentState()).toBe('sit');

      const runIntent = createSystemAnimationIntent('run', 'playful');
      expect(fsm.applyIntent(runIntent)).toBe(true);
      expect(fsm.getCurrentState()).toBe('run');

      const crawlIntent = createSystemAnimationIntent('crawl', 'curious');
      expect(fsm.applyIntent(crawlIntent)).toBe(true);
      expect(fsm.getCurrentState()).toBe('crawl');
    });
  });
});
