import { expect, it } from 'vitest';
import { projectCharacterExpression } from '../../src/domain/character/character-snapshot';
import { canExpressFlirt } from '../../src/domain/character/intimacy-rules';
import type { CharacterSnapshot } from '../../src/domain/character/types';

function snapshot(): CharacterSnapshot {
  return {
    needs: { energy: 70, comfort: 20, attention: 20, play: 20 },
    relationship: { friendship: 500, love: 0, loveUnlocked: true },
    personality: { presetId: 'curiousStubbornGirl', aiSelfConcept: 'Synthetic test snapshot',
      traits: { shyness: 0.5, playfulness: 0.5, sensitivity: 0.5, boldness: 0.5 } },
    intimacy: { flirtiness: 0, romanticCharge: 0, userConsentEnabled: true },
    synthesizedTone: 'neutral',
  };
}

it.each([
  [20, 79, 'gentle'], [21, 79, 'normal'], [21, 80, 'gentle'], [100, 100, 'gentle'],
] as const)('projects pace from current needs at energy=%s comfort=%s', (energy, comfort, pace) => {
  const source = snapshot();
  source.needs = { ...source.needs, energy, comfort };
  expect(projectCharacterExpression(source).pace).toBe(pace);
});

it.each([
  [399, 'guarded'], [400, 'familiar'], [499, 'familiar'], [500, 'close'],
] as const)('projects current trust at friendship=%s', (friendship, trust) => {
  const source = snapshot(); source.relationship.friendship = friendship;
  expect(projectCharacterExpression(source).trust).toBe(trust);
});

it.each([
  [89, 69, 'ordinary', 'ordinary'], [90, 69, 'high', 'ordinary'],
  [89, 70, 'ordinary', 'high'], [90, 70, 'high', 'high'],
] as const)('preserves independent attention=%s and play=%s needs', (attention, play, expectedAttention, expectedPlay) => {
  const source = snapshot(); source.needs = { ...source.needs, energy: 10, attention, play };
  expect(projectCharacterExpression(source)).toMatchObject({ pace: 'gentle', attention: expectedAttention, play: expectedPlay });
});

it.each([
  [true, true, 500, 30, 60, true],
  [false, true, 500, 30, 60, false],
  [true, false, 500, 30, 60, false],
  [true, true, 499, 30, 60, false],
  [true, true, 500, 29, 60, false],
  [true, true, 500, 30, 61, false],
] as const)('reuses all current romance gates: %s/%s/%s/%s/%s', (consent, unlocked, friendship, energy, comfort, allowed) => {
  const source = snapshot();
  source.intimacy.userConsentEnabled = consent;
  source.relationship = { ...source.relationship, loveUnlocked: unlocked, friendship };
  source.needs = { ...source.needs, energy, comfort };
  expect(projectCharacterExpression(source).romanceAllowed).toBe(allowed);
  expect(projectCharacterExpression(source).romanceAllowed).toBe(canExpressFlirt(source));
});

it('is deterministic without mutating or extending the local snapshot, even with contradictory tone', () => {
  const source = snapshot(); source.needs = { ...source.needs, energy: 10, attention: 95, play: 95 };
  source.synthesizedTone = 'playful';
  const before = structuredClone(source);
  expect(projectCharacterExpression(source)).toEqual({ pace: 'gentle', trust: 'close', attention: 'high', play: 'high', romanceAllowed: false });
  expect(projectCharacterExpression(source)).toEqual(projectCharacterExpression(source));
  expect(source).toEqual(before);
  expect(source).not.toHaveProperty('expression');
});
