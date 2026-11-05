import { expect, it } from 'vitest';
import { CharacterStateService } from '../../src/application/services/character-state.service';
import { applyInteractionProposal } from '../../src/domain/character/interaction-effects';
import { metabolizeNeeds } from '../../src/domain/character/metabolism';

it('slows repeated physical stress without changing energy costs or stress relief', () => {
  const character = new CharacterStateService({ now: () => 0 });
  const before = character.getState();
  for (let i = 0; i < 20; i++) character.applyStimulus({ type: 'system_event', metadata: { dragRunId: `drag-${i}`, heldMs: 1000 } });
  expect(character.getState().needs.comfort - before.needs.comfort).toBeCloseTo(10);
  const preCrash = character.getState();
  character.applyStimulus({ type: 'system_event', metadata: { landingOutcome: 'crash_landing' } });
  const postCrash = character.getState();
  expect(postCrash.needs.comfort - preCrash.needs.comfort).toBeCloseTo(1.5);
  expect(postCrash.needs.energy).toBe(preCrash.needs.energy - 2);
  character.applyStimulus({ type: 'pet' });
  expect(character.getState().needs.comfort).toBeCloseTo(postCrash.needs.comfort - 6);
});

it('slows positive appraisal stress and passive drift while preserving supportive relief', () => {
  const state = new CharacterStateService({ now: () => 0 }).getState();
  const hostile = applyInteractionProposal(state, { category: 'hostile', intensity: 'moderate', confidence: 'clear' });
  expect(hostile.needs.comfort - state.needs.comfort).toBe(1);
  const supported = applyInteractionProposal(hostile, { category: 'supportive', intensity: 'low', confidence: 'clear' });
  expect(supported.needs.comfort).toBe(hostile.needs.comfort - 1);
  const passive = metabolizeNeeds({ ...state.needs, comfort: 0 }, 60 * 60_000, 'neutral');
  expect(passive.comfort).toBeGreaterThan(0);
  expect(passive.comfort).toBeLessThan(1);
});
