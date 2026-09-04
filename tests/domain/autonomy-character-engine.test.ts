import { describe, expect, it } from 'vitest';
import { AutonomyCharacterEngine } from '../../src/domain/character';
import type { AutonomousCandidate, IPrng } from '../../src/domain/behavior';

const candidates = Object.freeze([
  Object.freeze({ kind: 'idle', source: 'timer', priority: 'low', reason: 'autonomous_idle' }),
  Object.freeze({ kind: 'wander', source: 'timer', priority: 'normal', reason: 'autonomous_wander' }),
  Object.freeze({ kind: 'sleep', source: 'timer', priority: 'high', moodHint: 'sleepy', reason: 'autonomous_nap' }),
] satisfies AutonomousCandidate[]);

const random: IPrng = { next: () => 0.4 };
const awakeSnapshot = {
  needs: { energy: 70, attention: 20, play: 20, comfort: 20, boredom: 20 },
  synthesizedTone: 'neutral' as const,
};

describe('Domain: AutonomyCharacterEngine', () => {
  it('accepts user sleep only through the Character-owned semantic transition', () => {
    const engine = new AutonomyCharacterEngine();
    expect(engine.resolveDirectIntent(
      { kind: 'sleep', source: 'user', priority: 'high' },
      awakeSnapshot
    )).toMatchObject({
      resolvedIntent: { kind: 'sleep' },
      semanticSleepState: 'sleeping',
      autonomyEligible: false,
    });
  });

  it('owns vital sleep and click wake transitions with a ready eligibility gate', () => {
    const engine = new AutonomyCharacterEngine();
    const sleep = engine.resolveAutonomousOpportunity({
      context: { decisionSequence: 1, opportunityAtMs: 10, tone: 'sleepy', idleElapsedMs: 0 },
      snapshot: { ...awakeSnapshot, needs: { ...awakeSnapshot.needs, energy: 20 } },
      candidates,
      prng: random,
    });

    expect(sleep).toMatchObject({
      resolvedIntent: { kind: 'sleep', reason: 'vital_sleep' },
      semanticSleepState: 'sleeping',
      autonomyEligible: false,
    });
    expect(engine.resolveAutonomousOpportunity({
      context: { decisionSequence: 2, opportunityAtMs: 20, tone: 'neutral', idleElapsedMs: 10_000 },
      snapshot: awakeSnapshot,
      candidates,
      prng: random,
    }).resolvedIntent).toBeNull();

    expect(engine.resolveDirectIntent(
      { kind: 'wake', source: 'user', priority: 'critical' },
      awakeSnapshot
    )).toMatchObject({
      resolvedIntent: { kind: 'wake' },
      semanticSleepState: 'awake',
      autonomyEligible: true,
    });
  });

  it('ends semantic sleep on drag without producing wake_up', () => {
    const engine = new AutonomyCharacterEngine();
    engine.resolveAutonomousOpportunity({
      context: { decisionSequence: 1, opportunityAtMs: 10, tone: 'sleepy', idleElapsedMs: 0 },
      snapshot: { ...awakeSnapshot, needs: { ...awakeSnapshot.needs, comfort: 85 } },
      candidates,
      prng: random,
    });

    const drag = engine.resolveDirectIntent(
      { kind: 'drag', source: 'user', priority: 'critical' },
      awakeSnapshot
    );

    expect(drag.resolvedIntent?.kind).toBe('drag');
    expect(drag.semanticSleepState).toBe('awake');
    expect(drag.resolvedIntent?.kind).not.toBe('wake');
  });
});
