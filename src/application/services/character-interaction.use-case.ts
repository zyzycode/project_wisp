import type { CharacterState, CharacterStimulus } from '../../domain/character';
import {
  CharacterStateService,
  defaultCharacterStateService,
} from './character-state.service';

export type CharacterInteractionType =
  | 'click'
  | 'double_click'
  | 'right_click'
  | 'drag_end'
  | 'pet'
  | 'play'
  | 'feed';

export interface CharacterInteraction {
  readonly type: CharacterInteractionType;
  readonly intensity?: number;
}

const STIMULUS_BY_INTERACTION: Record<CharacterInteractionType, CharacterStimulus['type']> = {
  click: 'user_click',
  double_click: 'user_double_click',
  right_click: 'user_right_click',
  drag_end: 'user_drag_end',
  pet: 'user_pet',
  play: 'play',
  feed: 'feed',
};

export class CharacterInteractionUseCase {
  constructor(private readonly characterStateService: CharacterStateService) {}

  public execute(interaction: CharacterInteraction): CharacterState {
    return this.characterStateService.applyStimulus({
      type: STIMULUS_BY_INTERACTION[interaction.type],
      source: 'user',
      intensity: interaction.intensity,
    });
  }
}

export const defaultCharacterInteractionUseCase = new CharacterInteractionUseCase(
  defaultCharacterStateService
);
