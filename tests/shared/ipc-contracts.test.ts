import { readFileSync } from 'node:fs';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  BeginPetDragDTO,
  BodyEventDTO,
  BrainStateDTO,
  CharacterInteractionDTO,
  CharacterInteractionTypeDTO,
  EnvironmentSnapshotDTO,
  SetAutonomyEnabledDTO,
  SleepWakeCommandDTO,
} from '../../src/shared/ipc-contracts';
import {
  parseBodyEventDTO,
  parseBrainStateDTO,
} from '../../src/shared/brain-body-ipc-validation';

function brainState(): BrainStateDTO {
  return {
    streamId: 'stream-1',
    revision: 1,
    sampledAtMs: 20,
    character: {
      needs: { energy: 80, attention: 30, play: 40, comfort: 50, boredom: 10 },
      synthesizedTone: 'neutral',
    },
    activity: null,
    motion: {
      phase: 'grounded',
      rootScreenPosition: { x: 1, y: 2 },
      velocityPxPerSec: { x: 0, y: 0 },
      positionAuthority: 'voluntary',
    },
    visualIntent: {
      episodeId: 'episode-1',
      episodeStartedAtMs: 10,
      kind: 'idle_blink',
      category: 'idle',
      priority: 'low',
      interrupt: 'yes',
      loop: 'until_replaced',
      emotionalTone: 'neutral',
      expressionHint: 'idle',
      propHint: 'none',
    },
  };
}

describe('Shared: IPC contracts', () => {
  it('remains a dependency leaf without imports from application layers', () => {
    const source = readFileSync(new URL('../../src/shared/ipc-contracts.ts', import.meta.url), 'utf8');

    expect(source).not.toMatch(/^import .*\.\.\/(domain|application|infrastructure)/m);
    expect(source).not.toMatch(/^export .*\.\.\/(domain|application|infrastructure)/m);
  });

  it('removes the legacy presentation and animation feedback protocol atomically', () => {
    const targets = [
      '../../src/shared/ipc-contracts.ts',
      '../../src/main/index.ts',
      '../../src/main/main-autonomy-composition.ts',
      '../../src/main/autonomy-ipc-registration.ts',
      '../../src/preload/index.ts',
      '../../src/renderer/components/DesktopPet.tsx',
    ];
    const runtimeSource = targets
      .map((target) => readFileSync(new URL(target, import.meta.url), 'utf8'))
      .join('\n');

    expect(runtimeSource).not.toMatch(
      /AnimationLifecycle|animationRequestId|notifyAnimation|PetPresentationState|pet:presentation-state|wisp:animation-lifecycle-result/
    );
  });

  it('provides standalone serializable Shimeji DTO shapes', () => {
    const environment: EnvironmentSnapshotDTO = {
      capturedAtMs: 1,
      screenBounds: { id: 'primary', x: 0, y: 0, width: 100, height: 100 },
    };
    const begin: BeginPetDragDTO = { pointerId: 1, sequence: 0, screenPosition: { x: 1, y: 2 } };
    const brain = brainState();
    const body: BodyEventDTO = {
      streamId: 'stream-1', sequence: 1, basedOnRevision: 1, observedAtMs: 30,
      type: 'interaction', interaction: 'think', intensity: 0.5,
    };
    const autonomy: SetAutonomyEnabledDTO = { enabled: true };
    const interaction: CharacterInteractionDTO = { type: 'click' };
    const sleepCommand: SleepWakeCommandDTO = { action: 'sleep' };
    const wakeCommand: SleepWakeCommandDTO = { action: 'wake' };

    expect({
      environment,
      begin,
      brain,
      body,
      autonomy,
      interaction,
      sleepCommand,
      wakeCommand,
    }).toBeDefined();
    expectTypeOf<'sleep'>().not.toMatchTypeOf<CharacterInteractionTypeDTO>();
    expectTypeOf<'wake'>().not.toMatchTypeOf<CharacterInteractionTypeDTO>();
  });

  it('copies exact Brain and Body payloads and rejects non-serializable or malformed shapes', () => {
    const brain = brainState();
    const parsedBrain = parseBrainStateDTO(brain);
    expect(parsedBrain).toEqual(brain);
    expect(parsedBrain).not.toBe(brain);
    expect(parsedBrain.motion).not.toBe(brain.motion);

    const body: BodyEventDTO = {
      streamId: 'stream-1', sequence: 2, basedOnRevision: 1, observedAtMs: 40,
      type: 'cursor_observed', screenPosition: { x: 3, y: 4 },
    };
    expect(parseBodyEventDTO(body)).toEqual(body);
    expect(() => parseBrainStateDTO({ ...brain, extra: true })).toThrow(TypeError);
    expect(() => parseBrainStateDTO({ ...brain, revision: Number.NaN })).toThrow(TypeError);
    expect(() => parseBrainStateDTO(Object.assign(Object.create({ inherited: true }), brain)))
      .toThrow(TypeError);
    expect(() => parseBodyEventDTO({ ...body, sequence: 0 })).toThrow(TypeError);
    expect(() => parseBodyEventDTO({ ...body, screenPosition: { x: Infinity, y: 4 } }))
      .toThrow(TypeError);
  });
});
