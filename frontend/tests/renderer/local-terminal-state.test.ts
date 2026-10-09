import { describe, expect, it } from 'vitest';
import { createSystemAnimationIntent } from '../../src/domain/animation/animation-intent';
import { applyLocalTerminalState } from '../../src/renderer/render-engine/local-terminal-state';
import type { BodyVisualState } from '../../src/renderer/render-engine/skin-engine';

const reaction: BodyVisualState = {
  streamId: 'stream', revision: 2, visualAgeMs: 800,
  visualIntent: { ...createSystemAnimationIntent('happy_reaction', 'playful'),
    episodeId: 'click-1', episodeSequence: 1, episodeStartedAtMs: 10 },
  reflex: { pupilOffset: { x: 0, y: 0 },
    transform: { flipX: false, scaleX: 1, scaleY: 1, rotationDeg: 0 } },
};

describe('local terminal visual projection', () => {
  it('passes the actual fallback intent to Skin without changing Brain state', () => {
    const initial = applyLocalTerminalState(reaction, null);
    const terminal = applyLocalTerminalState(reaction, 'idle_blink');
    expect(terminal.visualIntent).toMatchObject({ kind: 'idle_blink', expressionHint: 'idle', propHint: 'none' });
    expect(terminal.revision).toBeGreaterThan(initial.revision);
    expect(terminal.visualIntent.episodeId).toBe('click-1:local:idle_blink');
    expect(reaction.visualIntent.kind).toBe('happy_reaction');
    expect(applyLocalTerminalState({ ...reaction, revision: 3 }, null).revision).toBeGreaterThan(terminal.revision);
  });
});
