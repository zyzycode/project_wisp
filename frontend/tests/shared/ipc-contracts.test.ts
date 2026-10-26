import { readFileSync } from 'node:fs';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  BodyEventDTO,
  BodyInteractionTypeDTO,
  BrainStateDTO,
} from '../../src/shared/ipc-contracts';
import {
  parseBodyEventDTO,
  parseBrainStateDTO,
} from '../../src/shared/brain-body-ipc-validation';

function brainState(): BrainStateDTO {
  return {
    autonomy: { quiet: false }, cursorGame: null,
    dialogue: { conversationId: 'conversation-1', canSubmit: true, turn: { phase: 'idle' } },
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
      episodeSequence: 1,
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

// Compile-time boundary: semantic sleep/wake commands are not Body interactions.
expectTypeOf<'sleep'>().not.toMatchTypeOf<BodyInteractionTypeDTO>();
expectTypeOf<'wake'>().not.toMatchTypeOf<BodyInteractionTypeDTO>();

describe('Shared: IPC contracts', () => {
  it.each([undefined, 0, -1, .5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid visual episode sequence %s', episodeSequence => {
      const brain = brainState();
      expect(() => parseBrainStateDTO({ ...brain, visualIntent: { ...brain.visualIntent, episodeSequence } })).toThrow(TypeError);
    });
  it('remains a dependency leaf without imports from application layers', () => {
    const source = readFileSync(new URL('../../src/shared/ipc-contracts.ts', import.meta.url), 'utf8');

    expect(source).not.toMatch(/^import .*\.\.\/(domain|application|infrastructure)/m);
    expect(source).not.toMatch(/^export .*\.\.\/(domain|application|infrastructure)/m);
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
