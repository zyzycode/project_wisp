import { describe, it, expect } from 'vitest';
import {
  recordPetInteraction,
  calculateAffectionDecay,
  INITIAL_AFFECTION_STATE,
} from '../../src/domain/interaction/pet-interaction';

describe('Domain: Pet Interaction & Affection', () => {
  it('increases affection score on petting and single clicks', () => {
    const initial = { ...INITIAL_AFFECTION_STATE, affectionScore: 50, pettedCount: 0 };
    const updated = recordPetInteraction(initial, 'single_click', 1000);

    expect(updated.affectionScore).toBe(54);
    expect(updated.pettedCount).toBe(1);
    expect(updated.lastInteractedAt).toBe(1000);
    expect(updated.mood).toBe('happy');
  });

  it('updates mood to delighted when affection exceeds 75', () => {
    const highAffection = { ...INITIAL_AFFECTION_STATE, affectionScore: 72 };
    const updated = recordPetInteraction(highAffection, 'double_click', 2000);

    expect(updated.affectionScore).toBe(80);
    expect(updated.mood).toBe('delighted');
  });

  it('clamps affection score to a maximum of 100', () => {
    const nearMax = { ...INITIAL_AFFECTION_STATE, affectionScore: 98 };
    const updated = recordPetInteraction(nearMax, 'double_click', 3000);

    expect(updated.affectionScore).toBe(100);
  });

  it('handles drag_end and petting interaction types correctly', () => {
    const state = { ...INITIAL_AFFECTION_STATE, affectionScore: 50, pettedCount: 2 };
    const dragged = recordPetInteraction(state, 'drag_end', 4000);
    expect(dragged.affectionScore).toBe(52);
    expect(dragged.pettedCount).toBe(2);

    const petted = recordPetInteraction(dragged, 'petting', 5000);
    expect(petted.affectionScore).toBe(56);
    expect(petted.pettedCount).toBe(3);
  });

  it('decays affection linearly over time and advances lastInteractedAt', () => {
    const state = { ...INITIAL_AFFECTION_STATE, affectionScore: 80, lastInteractedAt: 1000 };
    const twoMinutesLater = 1000 + 120000;

    const decayed = calculateAffectionDecay(state, twoMinutesLater, 60000);
    expect(decayed.affectionScore).toBe(76);
    expect(decayed.lastInteractedAt).toBe(1000 + 120000);

    // Sequential second decay calculation
    const threeMinutesLater = twoMinutesLater + 60000;
    const decayedAgain = calculateAffectionDecay(decayed, threeMinutesLater, 60000);
    expect(decayedAgain.affectionScore).toBe(74);
    expect(decayedAgain.lastInteractedAt).toBe(threeMinutesLater);
  });

  it('does not decay below the minimum floor of 10', () => {
    const lowState = { ...INITIAL_AFFECTION_STATE, affectionScore: 12, lastInteractedAt: 0 };
    const farFuture = 10000000;

    const decayed = calculateAffectionDecay(lowState, farFuture, 60000);
    expect(decayed.affectionScore).toBe(10);
    expect(decayed.mood).toBe('neutral');
  });

  it('leaves state untouched if decay interval has not elapsed', () => {
    const state = { ...INITIAL_AFFECTION_STATE, affectionScore: 50, lastInteractedAt: 1000 };
    const justThirtySecLater = 1000 + 30000;

    const decayed = calculateAffectionDecay(state, justThirtySecLater, 60000);
    expect(decayed).toBe(state);
  });
});
