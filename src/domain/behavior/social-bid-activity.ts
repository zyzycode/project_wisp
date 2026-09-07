import type { ActivityDefinition } from './activity-runner';
/** No target observation is needed for a stationary, nonverbal invitation. */
export function createSocialBidActivity(waitMs: number): ActivityDefinition {
  return { id: 'social_bid', priority: 'P4_autonomous', baseWeight: 1, tags: ['social'], entryStepId: 'notice', steps: [
    { id: 'notice', actionId: 'social_notice', type: 'animation', stage: 'entering', intent: { kind: 'look_around' },
      completion: { type: 'elapsed', durationMs: 600 }, next: 'gesture' },
    { id: 'gesture', actionId: 'social_wave', type: 'animation', stage: 'looping', intent: { kind: 'wave' },
      completion: { type: 'elapsed', durationMs: 1200 }, next: 'wait' },
    { id: 'wait', actionId: 'social_wait', type: 'animation', stage: 'exiting', intent: { kind: 'idle_blink' },
      completion: { type: 'elapsed', durationMs: waitMs } },
  ] };
}
