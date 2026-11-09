import { describe, expect, it } from 'vitest';
import { createSystemAnimationIntent } from '../../src/domain/animation/animation-intent';
import { MainPublishedVisualEpisode } from '../../src/main/main-published-visual-episode';
import { toBrainStateDTO } from '../../src/main/mappers/shimeji-ipc.mapper';
import type { BrainVisualEpisode } from '../../src/main/main-visual-episode-state';
import { BrainStateRevisionGate } from '../../src/renderer/pet-main-bridge';
import type { BrainStateDTO } from '../../src/shared/ipc-contracts';

const idle = createSystemAnimationIntent('idle_blink');
function source(sequence = 1): BrainVisualEpisode {
  return { id: `${sequence}:source`, sequence, startedAtMs: sequence * 10, intent: { ...idle } };
}
function bodyState(episode: BrainVisualEpisode, revision: number): BrainStateDTO {
  return toBrainStateDTO({
    streamId: 'stream', revision, sampledAtMs: 100,
    dialogue: { conversationId: 'conversation', canSubmit: true, turn: { phase: 'idle' } },
    cursorGame: null, activity: null, autonomy: { quiet: false },
    character: { needs: { energy: 70, boredom: 80, play: 10, attention: 40, comfort: 20 }, synthesizedTone: 'neutral' },
    motion: { phase: 'grounded', position: { x: 10, y: 20 }, velocityPxPerSec: { x: 0, y: 0 }, activeBoundsId: 'screen', airborneElapsedSec: 0, peakGroundImpactSeverity: 0 },
    visualEpisode: episode,
  });
}

describe('Main published visual episodes', () => {
  it('publishes causal changes and revocation as immutable episodes accepted by the real Body gate', () => {
    const projector = new MainPublishedVisualEpisode();
    const raw = source();
    const first = projector.project(raw, raw.intent, 20);
    const pout = projector.project(raw, { ...raw.intent, expressionHint: 'pout' }, 30);
    const initialGate = new BrainStateRevisionGate(() => {});
    expect(initialGate.accept(bodyState(first, 1))).not.toBeNull();
    expect(initialGate.accept(bodyState(pout, 2))).not.toBeNull();
    expect(projector.project(raw, { ...raw.intent, expressionHint: 'pout' }, 35)).toBe(pout);
    const revoked = projector.project(raw, raw.intent, 40);
    const next = projector.project(source(2), idle, 50);
    expect([first, pout, revoked, next].map(value => value.sequence)).toEqual([1, 2, 3, 4]);
    expect(new Set([first, pout, revoked, next].map(value => value.id)).size).toBe(4);
    for (const episode of [first, pout, revoked, next]) expect(episode.id).toMatch(new RegExp(`^${episode.sequence}:\\S+$`));
    expect([first, pout, revoked, next].map(value => value.startedAtMs)).toEqual([10, 30, 40, 20]);
    expect(raw).toEqual(source());
    const gate = new BrainStateRevisionGate(() => {});
    for (const [index, episode] of [first, pout, revoked, next].entries()) {
      expect(gate.accept(bodyState(episode, index + 1))).not.toBeNull();
    }
  });

  it('compares normalized full wire meaning without replaying for non-wire metadata', () => {
    const projector = new MainPublishedVisualEpisode();
    const raw = source();
    const first = projector.project(raw, raw.intent, 20);
    expect(projector.project(raw, { ...raw.intent, requestedBy: 'other', gazeDirection: undefined }, 30)).toBe(first);
    const changed = projector.project(raw, { ...raw.intent, gazeDirection: 'left' }, 40);
    expect(changed.sequence).toBe(2);
    expect(changed.intent.gazeDirection).toBe('left');
  });

  it('rejects upstream mutation and sequence reversal before accepting a new projection', () => {
    const projector = new MainPublishedVisualEpisode();
    const raw = source(2);
    const first = projector.project(raw, raw.intent, 30);
    for (const invalid of [source(1), { ...raw, id: 'other' }, { ...raw, startedAtMs: 21 },
      { ...raw, intent: { ...raw.intent, requestedBy: 'changed' } }, { ...source(3), id: raw.id }]) {
      expect(() => projector.project(invalid, { ...idle, expressionHint: 'pout' }, 40)).toThrow();
    }
    expect(projector.project(raw, raw.intent, 50)).toBe(first);
  });

  it('rejects a null mutation of an absent raw hint even when the overlay masks it', () => {
    const projector = new MainPublishedVisualEpisode();
    const raw = source();
    const { expressionHint: _removed, ...withoutHint } = raw.intent;
    const original = { ...raw, intent: withoutHint };
    projector.project(original, { ...idle, expressionHint: 'pout' }, 20);
    Reflect.set(original.intent, 'expressionHint', null);
    expect(() => projector.project(original, { ...idle, expressionHint: 'pout' }, 30)).toThrow();
  });

  it('restarts publication identity only after an explicit stream reset', () => {
    const projector = new MainPublishedVisualEpisode();
    const gate = new BrainStateRevisionGate(() => {});
    expect(gate.accept(bodyState(projector.project(source(4), idle, 50), 1))).not.toBeNull();
    projector.reset();
    const restarted = projector.project(source(), idle, 20);
    expect(restarted).toMatchObject({ sequence: 1, startedAtMs: 10 });
    gate.reset();
    expect(gate.accept({ ...bodyState(restarted, 1), streamId: 'replacement-stream' })).not.toBeNull();
  });
});
