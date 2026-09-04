import { readFileSync } from 'node:fs';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  AnimationLifecycleResultDTO,
  BeginPetDragDTO,
  CharacterInteractionDTO,
  CharacterInteractionTypeDTO,
  EnvironmentSnapshotDTO,
  PetPresentationStateDTO,
  SetAutonomyEnabledDTO,
  SleepWakeCommandDTO,
} from '../../src/shared/ipc-contracts';

describe('Shared: IPC contracts', () => {
  it('remains a dependency leaf without imports from application layers', () => {
    const source = readFileSync(new URL('../../src/shared/ipc-contracts.ts', import.meta.url), 'utf8');

    expect(source).not.toMatch(/^import .*\.\.\/(domain|application|infrastructure)/m);
    expect(source).not.toMatch(/^export .*\.\.\/(domain|application|infrastructure)/m);
  });

  it('provides standalone serializable Shimeji DTO shapes', () => {
    const environment: EnvironmentSnapshotDTO = {
      capturedAtMs: 1,
      screenBounds: { id: 'primary', x: 0, y: 0, width: 100, height: 100 },
    };
    const begin: BeginPetDragDTO = { pointerId: 1, sequence: 0, screenPosition: { x: 1, y: 2 } };
    const presentation: PetPresentationStateDTO = {
      revision: 1, motionPhase: 'grounded', rootScreenPosition: { x: 1, y: 2 },
      velocityPxPerSec: { x: 0, y: 0 }, positionAuthority: 'voluntary', animationState: 'idle',
    };
    const autonomy: SetAutonomyEnabledDTO = { enabled: true };
    const interaction: CharacterInteractionDTO = { type: 'click' };
    const sleepCommand: SleepWakeCommandDTO = { action: 'sleep' };
    const wakeCommand: SleepWakeCommandDTO = { action: 'wake' };
    const animationResult: AnimationLifecycleResultDTO = {
      requestId: 'animation-1',
      outcome: 'completed',
    };

    expect({
      environment,
      begin,
      presentation,
      autonomy,
      interaction,
      sleepCommand,
      wakeCommand,
      animationResult,
    }).toBeDefined();
    expectTypeOf<'sleep'>().not.toMatchTypeOf<CharacterInteractionTypeDTO>();
    expectTypeOf<'wake'>().not.toMatchTypeOf<CharacterInteractionTypeDTO>();
  });
});
