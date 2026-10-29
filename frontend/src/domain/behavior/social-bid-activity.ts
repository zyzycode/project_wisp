import type { ActivityDefinition, ActivityStep } from './activity-runner';
import { SOCIAL_FOLLOWUP_TUNING } from './social-bid-followup-policy';
export type SocialBidAttempt = 'first' | 'second';
export const SOCIAL_SCENE_TUNING = { disengageMs: 800, settleMs: 600 } as const;
/** No target observation is needed for a stationary, nonverbal invitation. */
export function createSocialBidActivity(waitMs: number, priority: 'P3_reactive' | 'P4_autonomous' = 'P4_autonomous', attempt: SocialBidAttempt = 'first'): ActivityDefinition {
  const ending: readonly ActivityStep[] = priority === 'P4_autonomous' ? [
    { id: 'disengage', actionId: 'social_disengage', type: 'animation', stage: 'exiting', intent: { kind: 'look_around' },
      completion: { type: 'elapsed', durationMs: SOCIAL_SCENE_TUNING.disengageMs }, next: 'settle' },
    { id: 'settle', actionId: 'social_settle', type: 'animation', stage: 'exiting', intent: { kind: 'settle' },
      completion: { type: 'elapsed', durationMs: SOCIAL_SCENE_TUNING.settleMs } },
  ] : [];
  const next = ending.length ? 'disengage' : undefined;
  if (attempt === 'second') return { id: 'social_bid', priority, baseWeight: 1, tags: ['social'], entryStepId: 'gesture', steps: [
    { id: 'gesture', actionId: 'social_curious', type: 'animation', stage: 'looping',
      intent: { kind: 'thinking_loop', expressionHint: 'curious', propHint: 'none' },
      completion: { type: 'elapsed', durationMs: SOCIAL_FOLLOWUP_TUNING.gestureMs }, next: 'wait' },
    { id: 'wait', actionId: 'social_wait', type: 'animation', stage: 'exiting', intent: { kind: 'idle_blink' },
      completion: { type: 'elapsed', durationMs: Math.min(waitMs, SOCIAL_FOLLOWUP_TUNING.waitMs) }, next },
    ...ending,
  ] };
  return { id: 'social_bid', priority, baseWeight: 1, tags: ['social'], entryStepId: 'notice', steps: [
    { id: 'notice', actionId: 'social_notice', type: 'animation', stage: 'entering', intent: { kind: 'look_around' },
      completion: { type: 'elapsed', durationMs: 600 }, next: 'gesture' },
    { id: 'gesture', actionId: 'social_wave', type: 'animation', stage: 'looping', intent: { kind: 'wave' },
      completion: { type: 'elapsed', durationMs: 1200 }, next: 'wait' },
    { id: 'wait', actionId: 'social_wait', type: 'animation', stage: 'exiting', intent: { kind: 'idle_blink' },
      completion: { type: 'elapsed', durationMs: waitMs }, next },
    ...ending,
  ] };
}
