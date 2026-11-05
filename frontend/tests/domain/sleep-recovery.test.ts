import { expect, it } from 'vitest';
import { metabolizeNeeds } from '../../src/domain/character/metabolism';
import { AutonomyCharacterEngine, type CharacterAutonomySnapshot } from '../../src/domain/character/autonomy-character-engine';

const exhausted: CharacterAutonomySnapshot = {
  needs: { energy: 0, attention: 20, play: 20, comfort: 100, boredom: 15 },
  synthesizedTone: 'sleepy',
};

it('recovers from exhaustion and overload within four minutes of sleep', () => {
  const needs = metabolizeNeeds(exhausted.needs, 4 * 60_000, 'sleepy');
  expect(needs.energy).toBeGreaterThanOrEqual(80);
  expect(needs.comfort).toBeLessThan(20);
  const minute = metabolizeNeeds(exhausted.needs, 60_000, 'sleepy');
  expect(minute.energy).toBeLessThan(80);
  const continued = metabolizeNeeds(minute, 3 * 60_000, 'sleepy');
  expect(continued.energy).toBeCloseTo(needs.energy);
  expect(continued.comfort).toBeCloseTo(needs.comfort);
});

it('keeps manual wake ahead of automatic sleep and provider sleep until recovery', () => {
  const engine = new AutonomyCharacterEngine();
  engine.beginRest();
  engine.resolveDirectIntent({ kind: 'wake', source: 'user', priority: 'critical' }, exhausted);
  const choose = (snapshot: CharacterAutonomySnapshot) => engine.resolveAutonomousOpportunity({
    context: { decisionSequence: 1, opportunityAtMs: 1, tone: 'sleepy' }, snapshot,
    candidates: [{ kind: 'sleep', source: 'timer', priority: 'high' }], prng: { next: () => 0 },
    selection: { nowMs: 1, canExplore: false, canPlay: false, canRest: true, history: [] },
  });
  expect(choose(exhausted).semanticSleepState).toBe('awake');
  expect(engine.resolveProviderIntent({ kind: 'sleep', source: 'provider', priority: 'normal' }, exhausted)).toBeNull();
  expect(choose({ ...exhausted, needs: { ...exhausted.needs, energy: 40 } }).semanticSleepState).toBe('awake');
  choose({ ...exhausted, needs: { ...exhausted.needs, energy: 85, comfort: 15 } });
  expect(choose(exhausted).semanticSleepState).toBe('sleeping');
});
