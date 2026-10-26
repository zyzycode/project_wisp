import type { ActivityDefinition } from './activity-runner';
import { SOCIAL_FOLLOWUP_TUNING } from './social-bid-followup-policy';
export type SocialBidAttempt = 'first' | 'second';
/** No target observation is needed for a stationary, nonverbal invitation. */
export function createSocialBidActivity(waitMs: number, priority: 'P3_reactive' | 'P4_autonomous' = 'P4_autonomous', attempt: SocialBidAttempt = 'first'): ActivityDefinition {
  if (attempt === 'second') return { id: 'social_bid', priority, baseWeight: 1, tags: ['social'], entryStepId: 'gesture', steps: [
    { id: 'gesture', actionId: 'social_curious', type: 'animation', stage: 'looping',
      intent: { kind: 'thinking_loop', expressionHint: 'curious', propHint: 'none' },
      completion: { type: 'elapsed', durationMs: SOCIAL_FOLLOWUP_TUNING.gestureMs }, next: 'wait' },
    { id: 'wait', actionId: 'social_wait', type: 'animation', stage: 'exiting', intent: { kind: 'idle_blink' },
      completion: { type: 'elapsed', durationMs: Math.min(waitMs, SOCIAL_FOLLOWUP_TUNING.waitMs) } },
  ] };
  return { id: 'social_bid', priority, baseWeight: 1, tags: ['social'], entryStepId: 'notice', steps: [
    { id: 'notice', actionId: 'social_notice', type: 'animation', stage: 'entering', intent: { kind: 'look_around' },
      completion: { type: 'elapsed', durationMs: 600 }, next: 'gesture' },
    { id: 'gesture', actionId: 'social_wave', type: 'animation', stage: 'looping', intent: { kind: 'wave' },
      completion: { type: 'elapsed', durationMs: 1200 }, next: 'wait' },
    { id: 'wait', actionId: 'social_wait', type: 'animation', stage: 'exiting', intent: { kind: 'idle_blink' },
      completion: { type: 'elapsed', durationMs: waitMs } },
  ] };
}
