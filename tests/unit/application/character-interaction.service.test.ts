import { describe, expect, it } from 'vitest';
import { CharacterInteractionUseCase } from '../../../src/application/services/character-interaction.use-case';
import { CharacterStateService } from '../../../src/application/services/character-state.service';
import { shyDreamGirlPreset, type CharacterState } from '../../../src/domain/character';

function createState(): CharacterState {
  return {
    needs: {
      energy: 60,
      attention: 50,
      play: 70,
      comfort: 40,
      boredom: 50,
    },
    relationship: { friendship: 10, love: 0, loveUnlocked: false },
    personality: shyDreamGirlPreset,
    intimacy: {
      flirtiness: 0,
      romanticCharge: 0,
      userConsentEnabled: false,
      boundariesKnown: false,
    },
    preferences: {},
    lastUpdated: 1000,
  };
}

describe('Application: CharacterInteractionUseCase', () => {
  it('applies semantic play stimulus to character needs', () => {
    const stateService = new CharacterStateService({ initialState: createState() });
    const useCase = new CharacterInteractionUseCase(stateService);

    const after = useCase.execute({ type: 'play' });

    expect(after.needs.play).toBe(55);
    expect(after.needs.energy).toBe(57);
    expect(after.needs.boredom).toBe(32);
    expect(after.relationship.friendship).toBe(13);
  });

  it('applies semantic feed stimulus instead of a no-op system event', () => {
    const stateService = new CharacterStateService({ initialState: createState() });
    const useCase = new CharacterInteractionUseCase(stateService);

    const after = useCase.execute({ type: 'feed' });

    expect(after.needs.energy).toBe(66);
    expect(after.needs.comfort).toBe(36);
    expect(after.relationship.friendship).toBe(12);
  });

  it('maps renderer interaction commands to the existing canonical stimuli', () => {
    const stateService = new CharacterStateService({ initialState: createState() });
    const useCase = new CharacterInteractionUseCase(stateService);

    const afterClick = useCase.execute({ type: 'click' });
    const afterPet = useCase.execute({ type: 'pet' });
    const afterDrag = useCase.execute({ type: 'drag_end' });

    expect(afterClick.needs.attention).toBe(46);
    expect(afterPet.needs.attention).toBe(37);
    expect(afterDrag.needs).toEqual(afterPet.needs);
  });
});
