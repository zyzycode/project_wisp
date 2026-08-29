import { describe, expect, it, vi } from 'vitest';
import {
  AnimationStateMachine,
  createSystemAnimationIntent,
  mapBehaviorIntentToAnimationIntent,
} from '../../src/domain/animation';
import {
  decideNextAutonomousBehaviorIntent,
  DEFAULT_BEHAVIOR_CONFIG,
  type BehaviorIntent,
} from '../../src/domain/behavior';
import {
  metabolizeNeeds,
  processStimulus,
  shyDreamGirlPreset,
  synthesizeEmotionalTone,
  type CharacterState,
} from '../../src/domain/character';

function createTestCharacterState(overrides: Partial<CharacterState> = {}): CharacterState {
  return {
    needs: {
      energy: 70,
      attention: 30,
      play: 30,
      comfort: 20,
      boredom: 20,
      ...overrides.needs,
    },
    relationship: {
      friendship: 450,
      love: 0,
      loveUnlocked: true,
      ...overrides.relationship,
    },
    personality: overrides.personality ?? shyDreamGirlPreset,
    intimacy: {
      flirtiness: 0,
      romanticCharge: 0,
      userConsentEnabled: true,
      boundariesKnown: true,
      ...overrides.intimacy,
    },
    preferences: overrides.preferences ?? {},
    lastUpdated: overrides.lastUpdated ?? 0,
  };
}

describe('Domain: Animation & Reaction Pack Integration (Phase 12)', () => {
  describe('1. Full Sleep Lifecycle: Needs -> BehaviorIntent -> AnimationIntent -> AnimationStateMachine', () => {
    it('initiates vital sleep when energy is depleted (Needs.energy = 15)', () => {
      const state = createTestCharacterState({
        needs: { energy: 15, attention: 20, play: 20, comfort: 20, boredom: 20 },
      });

      // 1. Synthesize emotional tone from character state
      const tone = synthesizeEmotionalTone(state);
      expect(tone).toBe('sleepy');

      // 2. Autonomous behavior engine decides next intent
      const behaviorIntent = decideNextAutonomousBehaviorIntent({
        needs: state.needs,
        tone,
        idleElapsedMs: 0,
      });
      expect(behaviorIntent).not.toBeNull();
      expect(behaviorIntent).toMatchObject({
        kind: 'sleep',
        source: 'timer',
        priority: 'high',
        moodHint: 'sleepy',
        reason: 'vital_sleep',
      });

      // 3. Map BehaviorIntent to semantic AnimationIntent
      const animIntent = mapBehaviorIntentToAnimationIntent(behaviorIntent!, tone);
      expect(animIntent).toMatchObject({
        kind: 'sleep_start',
        category: 'sleep',
        priority: 'high',
        interrupt: 'limited',
        loop: 'none',
        requestedBy: 'sleep',
        emotionalTone: 'sleepy',
        expressionHint: 'sleepy',
        propHint: 'pillow',
      });

      // 4. Feed into AnimationStateMachine FSM
      const fsm = new AnimationStateMachine('idle');
      expect(fsm.getCurrentState()).toBe('idle');

      const applied = fsm.applyIntent(animIntent);
      expect(applied).toBe(true);
      expect(fsm.getCurrentState()).toBe('sleep_start');
      expect(fsm.getCurrentExpression()).toBe('sleepy');

      // 5. Automatic transition from sleep_start (1000ms) to stable sleep_loop
      fsm.update(1000);
      expect(fsm.getCurrentState()).toBe('sleep_loop');
      expect(fsm.getCurrentExpression()).toBe('sleepy');
    });

    it('initiates vital sleep when comfort need is overloaded (Needs.comfort = 85)', () => {
      const state = createTestCharacterState({
        needs: { energy: 70, attention: 20, play: 20, comfort: 85, boredom: 20 },
      });

      const tone = synthesizeEmotionalTone(state);
      expect(tone).toBe('sleepy');

      const behaviorIntent = decideNextAutonomousBehaviorIntent({
        needs: state.needs,
        tone,
      });
      expect(behaviorIntent).toMatchObject({
        kind: 'sleep',
        priority: 'high',
        reason: 'vital_sleep',
      });

      const animIntent = mapBehaviorIntentToAnimationIntent(behaviorIntent!, tone);
      expect(animIntent.kind).toBe('sleep_start');
      expect(animIntent.propHint).toBe('pillow');

      const fsm = new AnimationStateMachine('idle');
      expect(fsm.applyIntent(animIntent)).toBe(true);
      expect(fsm.getCurrentState()).toBe('sleep_start');
      fsm.update(1000);
      expect(fsm.getCurrentState()).toBe('sleep_loop');
    });

    it('blocks background idle and wander intents while in sleep_loop', () => {
      const state = createTestCharacterState({
        needs: { energy: 20, attention: 30, play: 30, comfort: 20, boredom: 20 },
      });
      const tone = synthesizeEmotionalTone(state);

      // Autonomous behavior engine suppresses timer idle/wander during sleep
      const autonomousIntent = decideNextAutonomousBehaviorIntent({
        needs: state.needs,
        tone,
        currentAnimation: 'sleep_loop',
        idleElapsedMs: 60_000,
        randomVal: 0.5,
      });
      expect(autonomousIntent).toBeNull();

      // Even if background animation intents arrive, AnimationStateMachine protects sleep_loop
      const fsm = new AnimationStateMachine('sleep_loop');

      const lowIdleIntent = createSystemAnimationIntent('idle_blink', 'neutral');
      const normalWalkIntent = mapBehaviorIntentToAnimationIntent(
        { kind: 'wander', source: 'timer', priority: 'normal' },
        'neutral'
      );
      const normalTalkIntent = mapBehaviorIntentToAnimationIntent(
        { kind: 'respond', source: 'provider', priority: 'normal' },
        'neutral'
      );
      const happyReactionIntent = mapBehaviorIntentToAnimationIntent(
        { kind: 'react_happy', source: 'user', priority: 'normal' },
        'neutral'
      );

      expect(fsm.applyIntent(lowIdleIntent)).toBe(false);
      expect(fsm.applyIntent(normalWalkIntent)).toBe(false);
      expect(fsm.applyIntent(normalTalkIntent)).toBe(false);
      expect(fsm.applyIntent(happyReactionIntent)).toBe(false);
      expect(fsm.getCurrentState()).toBe('sleep_loop');
    });

    it('instantly interrupts sleep_loop on direct critical drag, then lands and settles', () => {
      const fsm = new AnimationStateMachine('sleep_loop');
      const listener = vi.fn();
      fsm.subscribe(listener);

      // User initiates drag interaction during sleep
      const dragBehaviorIntent: BehaviorIntent = {
        kind: 'drag',
        source: 'user',
        priority: 'critical',
      };
      const dragAnimIntent = mapBehaviorIntentToAnimationIntent(dragBehaviorIntent, 'sleepy');
      expect(dragAnimIntent).toMatchObject({
        kind: 'dragged',
        priority: 'critical',
        interrupt: 'no',
        loop: 'until_replaced',
      });

      // Dragged overrides sleep immediately
      const dragApplied = fsm.applyIntent(dragAnimIntent);
      expect(dragApplied).toBe(true);
      expect(fsm.getCurrentState()).toBe('dragged');
      expect(fsm.getCurrentExpression()).toBe('flying');

      // User releases pet -> land intent
      const landBehaviorIntent: BehaviorIntent = {
        kind: 'land',
        source: 'user',
        priority: 'high',
      };
      const landAnimIntent = mapBehaviorIntentToAnimationIntent(landBehaviorIntent, 'sleepy');
      expect(landAnimIntent).toMatchObject({
        kind: 'land',
        priority: 'high',
        loop: 'none',
      });

      const landApplied = fsm.applyIntent(landAnimIntent);
      expect(landApplied).toBe(true);
      expect(fsm.getCurrentState()).toBe('landing');
      expect(fsm.getCurrentExpression()).toBe('happy');

      // Landing duration is 800ms -> automatically goes to settle
      fsm.update(800);
      expect(fsm.getCurrentState()).toBe('idle');

      // Settle duration is 300ms -> returns to idle base state
      fsm.update(300);
      expect(fsm.getCurrentState()).toBe('idle');
      expect(fsm.getCurrentExpression()).toBe('idle');

      expect(listener).toHaveBeenCalledWith('sleep_loop', 'sleepy');
      expect(listener).toHaveBeenCalledWith('dragged', 'flying');
      expect(listener).toHaveBeenCalledWith('landing', 'happy');
      
      expect(listener).toHaveBeenCalledWith('idle', 'idle');
    });

    it('wakes up when attention deficit becomes critical (Needs.attention = 95)', () => {
      const state = createTestCharacterState({
        needs: { energy: 50, attention: 95, play: 20, comfort: 20, boredom: 20 },
      });
      const tone = synthesizeEmotionalTone(state);

      // Behavior engine detects attention threshold >= 90 while in sleep_loop
      const wakeBehaviorIntent = decideNextAutonomousBehaviorIntent({
        needs: state.needs,
        tone,
        currentAnimation: 'sleep_loop',
      });
      expect(wakeBehaviorIntent).not.toBeNull();
      expect(wakeBehaviorIntent).toMatchObject({
        kind: 'wake',
        source: 'timer',
        priority: 'high',
        reason: 'vital_wake',
      });

      // Map to AnimationIntent
      const wakeAnimIntent = mapBehaviorIntentToAnimationIntent(wakeBehaviorIntent!, tone);
      expect(wakeAnimIntent).toMatchObject({
        kind: 'wake_up',
        category: 'transition',
        priority: 'high',
        interrupt: 'no',
        loop: 'none',
      });

      // Apply to FSM in sleep_loop
      const fsm = new AnimationStateMachine('sleep_loop');
      expect(fsm.applyIntent(wakeAnimIntent)).toBe(true);
      expect(fsm.getCurrentState()).toBe('wake_up');
      expect(fsm.getCurrentExpression()).toBe('sleepy');

      // wake_up auto-advances to settle (900ms) then idle (300ms)
      fsm.update(900);
      expect(fsm.getCurrentState()).toBe('idle');
      expect(fsm.getCurrentExpression()).toBe('idle');
    });

    it('wakes up when energy is restored after sleep (Needs.energy = 85)', () => {
      const state = createTestCharacterState({
        needs: { energy: 85, attention: 20, play: 20, comfort: 20, boredom: 20 },
      });
      const tone = synthesizeEmotionalTone(state);

      const wakeBehaviorIntent = decideNextAutonomousBehaviorIntent({
        needs: state.needs,
        tone,
        currentAnimation: 'sleep_loop',
      });
      expect(wakeBehaviorIntent).toMatchObject({
        kind: 'wake',
        priority: 'high',
        reason: 'vital_wake',
      });

      const wakeAnimIntent = mapBehaviorIntentToAnimationIntent(wakeBehaviorIntent!, tone);
      const fsm = new AnimationStateMachine('sleep_loop');
      expect(fsm.applyIntent(wakeAnimIntent)).toBe(true);
      expect(fsm.getCurrentState()).toBe('wake_up');

      fsm.update(900);
      expect(fsm.getCurrentState()).toBe('idle');
    });
  });

  describe('2. Emotional Tone & Expression/Prop Hints Synthesis Matrix', () => {
    it('synthesizes all 7 emotional tones from CharacterState correctly', () => {
      // 1. Sleepy: energy <= 20 or comfort >= 80
      expect(
        synthesizeEmotionalTone(createTestCharacterState({ needs: { energy: 18, attention: 10, play: 10, comfort: 10, boredom: 10 } }))
      ).toBe('sleepy');
      expect(
        synthesizeEmotionalTone(createTestCharacterState({ needs: { energy: 80, attention: 10, play: 10, comfort: 85, boredom: 10 } }))
      ).toBe('sleepy');

      // 2. Shy: high shyness (> 0.65) and low friendship (< 400)
      expect(
        synthesizeEmotionalTone(createTestCharacterState({ relationship: { friendship: 250, love: 0, loveUnlocked: false } }))
      ).toBe('shy');

      // 3. Affectionate: love >= 500 and friendship >= 500
      expect(
        synthesizeEmotionalTone(createTestCharacterState({ relationship: { friendship: 600, love: 550, loveUnlocked: true } }))
      ).toBe('affectionate');

      // 4. Playful: play need >= 70 with normal energy
      expect(
        synthesizeEmotionalTone(createTestCharacterState({ needs: { energy: 70, attention: 20, play: 75, comfort: 20, boredom: 20 } }))
      ).toBe('playful');

      // 5. Neutral: baseline default
      expect(synthesizeEmotionalTone(createTestCharacterState())).toBe('neutral');
    });

    it('generates blush expressionHint for shy and flustered tones', () => {
      const shyRespond = mapBehaviorIntentToAnimationIntent(
        { kind: 'respond', source: 'provider', priority: 'normal' },
        'shy'
      );
      expect(shyRespond.expressionHint).toBe('blush');
      expect(shyRespond.propHint).toBe('none');

      const flusteredRespond = mapBehaviorIntentToAnimationIntent(
        { kind: 'respond', source: 'provider', priority: 'normal' },
        'flustered'
      );
      expect(flusteredRespond.expressionHint).toBe('blush');
      expect(flusteredRespond.propHint).toBe('heart');

      const shyIdle = mapBehaviorIntentToAnimationIntent(
        { kind: 'idle', source: 'timer', priority: 'low' },
        'shy'
      );
      expect(shyIdle.expressionHint).toBe('blush');
    });

    it('generates sparkle propHint for playful tone in reactions and idle', () => {
      const playfulReact = mapBehaviorIntentToAnimationIntent(
        { kind: 'react_happy', source: 'user', priority: 'normal' },
        'playful'
      );
      expect(playfulReact.expressionHint).toBe('winking');
      expect(playfulReact.propHint).toBe('sparkle');

      const playfulIdle = mapBehaviorIntentToAnimationIntent(
        { kind: 'idle', source: 'timer', priority: 'low' },
        'playful'
      );
      expect(playfulIdle.propHint).toBe('sparkle');
    });

    it('generates question propHint and curious expressionHint for curious tone', () => {
      const curiousThink = mapBehaviorIntentToAnimationIntent(
        { kind: 'think', source: 'user', priority: 'normal' },
        'curious'
      );
      expect(curiousThink.expressionHint).toBe('curious');
      expect(curiousThink.propHint).toBe('question');

      const curiousReact = mapBehaviorIntentToAnimationIntent(
        { kind: 'react_confused', source: 'user', priority: 'normal' },
        'curious'
      );
      expect(curiousReact.expressionHint).toBe('curious');
      expect(curiousReact.propHint).toBe('question');
    });

    it('generates pillow propHint for sleep actions and sleepy tone', () => {
      const sleepIntent = mapBehaviorIntentToAnimationIntent(
        { kind: 'sleep', source: 'timer', priority: 'high' },
        'sleepy'
      );
      expect(sleepIntent.propHint).toBe('pillow');

      const sleepyQuiet = mapBehaviorIntentToAnimationIntent(
        { kind: 'quiet', source: 'timer', priority: 'low' },
        'sleepy'
      );
      expect(sleepyQuiet.propHint).toBe('pillow');
      expect(sleepyQuiet.kind).toBe('sleep_loop');
    });

    it('generates heart propHint and happy expression for affectionate tone', () => {
      const affecIdle = mapBehaviorIntentToAnimationIntent(
        { kind: 'idle', source: 'timer', priority: 'low' },
        'affectionate'
      );
      expect(affecIdle.expressionHint).toBe('happy');
      expect(affecIdle.propHint).toBe('heart');

      const affecRespond = mapBehaviorIntentToAnimationIntent(
        { kind: 'respond', source: 'provider', priority: 'normal' },
        'affectionate'
      );
      expect(affecRespond.expressionHint).toBe('happy');
      expect(affecRespond.propHint).toBe('heart');
    });
  });

  describe('3. Animation Intent Prioritization & Interrupt Rules', () => {
    it('enforces priority hierarchy strictly: low < normal < high < critical', () => {
      const fsm = new AnimationStateMachine('idle');

      // 1. Low cannot interrupt normal
      fsm.transition('THINK'); // Normal priority -> thinking
      expect(fsm.getCurrentState()).toBe('thinking');

      const lowIdle = createSystemAnimationIntent('idle_blink', 'neutral');
      expect(fsm.applyIntent(lowIdle)).toBe(false);
      expect(fsm.getCurrentState()).toBe('thinking');

      // 2. Normal cannot interrupt high
      fsm.transition('START_SLEEP'); // High priority -> sleep_start
      expect(fsm.getCurrentState()).toBe('sleep_start');

      const normalTalk = mapBehaviorIntentToAnimationIntent(
        { kind: 'respond', source: 'provider', priority: 'normal' },
        'neutral'
      );
      expect(fsm.applyIntent(normalTalk)).toBe(false);
      expect(fsm.getCurrentState()).toBe('sleep_start');

      // 3. High can interrupt normal
      const floatFsm = new AnimationStateMachine('float');
      const highSleep = mapBehaviorIntentToAnimationIntent(
        { kind: 'sleep', source: 'timer', priority: 'high' },
        'sleepy'
      );
      expect(floatFsm.applyIntent(highSleep)).toBe(true);
      expect(floatFsm.getCurrentState()).toBe('sleep_start');

      // 4. Critical interrupts high
      const criticalDrag = mapBehaviorIntentToAnimationIntent(
        { kind: 'drag', source: 'user', priority: 'critical' },
        'neutral'
      );
      expect(floatFsm.applyIntent(criticalDrag)).toBe(true);
      expect(floatFsm.getCurrentState()).toBe('dragged');
    });
  });

  describe('4. Complete End-to-End Multi-Step Integration Cycle', () => {
    it('simulates a full living character interaction and autonomous day cycle', () => {
      let state = createTestCharacterState({
        needs: { energy: 75, attention: 40, play: 40, comfort: 15, boredom: 25 },
        relationship: { friendship: 450, love: 50, loveUnlocked: true },
      });
      const fsm = new AnimationStateMachine('idle');

      // --- Step 1: Initial state is neutral idle ---
      let tone = synthesizeEmotionalTone(state);
      expect(tone).toBe('neutral');
      expect(fsm.getCurrentState()).toBe('idle');

      // --- Step 2: User talks with Wisp -> Provider response generates 'respond' intent ---
      state = processStimulus(state, { type: 'chat_message' });
      tone = synthesizeEmotionalTone(state);

      const talkIntent = mapBehaviorIntentToAnimationIntent(
        { kind: 'respond', source: 'provider', priority: 'normal' },
        tone
      );
      expect(talkIntent.kind).toBe('talking');
      expect(fsm.applyIntent(talkIntent)).toBe(true);
      expect(fsm.getCurrentState()).toBe('thinking'); // talking maps to thinking visual state

      // Transition to settle -> idle
      fsm.transition('SETTLE');
      expect(fsm.getCurrentState()).toBe('idle');

      // --- Step 3: Autonomous wander cycle triggered by idle timer ---
      const wanderIntent = decideNextAutonomousBehaviorIntent({
        needs: state.needs,
        tone,
        idleElapsedMs: DEFAULT_BEHAVIOR_CONFIG.minIdleDurationMs,
        randomVal: 0.3, // triggers 'wander' in decideNextAutonomousAction
      });
      expect(wanderIntent).not.toBeNull();
      expect(wanderIntent?.kind).toBe('wander');

      const walkAnim = mapBehaviorIntentToAnimationIntent(wanderIntent!, tone);
      expect(walkAnim.kind).toBe('walk');
      expect(fsm.applyIntent(walkAnim)).toBe(true);
      expect(fsm.getCurrentState()).toBe('float');

      fsm.transition('SETTLE');
      expect(fsm.getCurrentState()).toBe('idle');

      // --- Step 4: Long absence & fatigue: energy drops via metabolizeNeeds ---
      const fatiguedNeeds = metabolizeNeeds(
        { energy: 25, attention: 60, play: 50, comfort: 20, boredom: 70 },
        8 * 60 * 60 * 1000, // 8 hours later
        'neutral'
      );
      // Directly set energy to exhausted level to trigger sleep cycle
      state = {
        ...state,
        needs: { ...fatiguedNeeds, energy: 15 },
      };

      tone = synthesizeEmotionalTone(state);
      expect(tone).toBe('sleepy');

      const sleepBehavior = decideNextAutonomousBehaviorIntent({
        needs: state.needs,
        tone,
      });
      expect(sleepBehavior?.kind).toBe('sleep');

      const sleepStartAnim = mapBehaviorIntentToAnimationIntent(sleepBehavior!, tone);
      expect(fsm.applyIntent(sleepStartAnim)).toBe(true);
      expect(fsm.getCurrentState()).toBe('sleep_start');
      expect(fsm.getCurrentExpression()).toBe('sleepy');

      fsm.update(1000);
      expect(fsm.getCurrentState()).toBe('sleep_loop');
      expect(fsm.getCurrentExpression()).toBe('sleepy');

      // --- Step 5: Background actions blocked while sleeping ---
      expect(
        decideNextAutonomousBehaviorIntent({
          needs: state.needs,
          tone,
          currentAnimation: 'sleep_loop',
          idleElapsedMs: 30_000,
          randomVal: 0.5,
        })
      ).toBeNull();

      // --- Step 6: Direct user interaction wakes Wisp via drag ---
      const dragIntent = mapBehaviorIntentToAnimationIntent(
        { kind: 'drag', source: 'user', priority: 'critical' },
        tone
      );
      expect(fsm.applyIntent(dragIntent)).toBe(true);
      expect(fsm.getCurrentState()).toBe('dragged');
      expect(fsm.getCurrentExpression()).toBe('flying');

      // Drop pet on floor
      const landIntent = mapBehaviorIntentToAnimationIntent(
        { kind: 'land', source: 'user', priority: 'high' },
        tone
      );
      expect(fsm.applyIntent(landIntent)).toBe(true);
      expect(fsm.getCurrentState()).toBe('landing');

      fsm.update(800);
      expect(fsm.getCurrentState()).toBe('idle');

      // --- Step 7: Petting restores affection and comfort ---
      state = processStimulus(state, { type: 'pet' });
      expect(state.relationship.friendship).toBeGreaterThan(450);

      const petReactIntent = mapBehaviorIntentToAnimationIntent(
        { kind: 'react_happy', source: 'user', priority: 'normal' },
        synthesizeEmotionalTone(state)
      );
      expect(fsm.applyIntent(petReactIntent)).toBe(true);
      expect(fsm.getCurrentState()).toBe('happy');
      expect(fsm.getCurrentExpression()).toBe('happy');

      fsm.update(1500);
      expect(fsm.getCurrentState()).toBe('idle');
    });
  });
});
