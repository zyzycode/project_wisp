import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it, vi } from 'vitest';
import { PetBodyController } from '../../src/renderer/pet-body-controller';
import { AssetResolver, ManifestLoader, SpriteSkinAdapter } from '../../src/renderer/render-engine';
import type { BrainStateDTO } from '../../src/shared/ipc-contracts';
import type { NormalizedSpriteManifest, RenderPresentationState } from '../../src/renderer/render-engine/types';

const manifest = new ManifestLoader().load(JSON.parse(readFileSync(resolve('public/assets/sprites/manifest.json'), 'utf8')));
function brain(outcome: 'caught' | 'missed' | 'lost_target'): BrainStateDTO {
  return { streamId: 'stream', revision: 1, sampledAtMs: 1600, autonomy: { quiet: false },
    dialogue: { conversationId: 'conversation', canSubmit: true, turn: { phase: 'idle' } },
    cursorGame: { runId: 'game', outcome, speech: null },
    character: { needs: { energy: 80, attention: 50, play: 80, comfort: 70, boredom: 50 }, synthesizedTone: 'neutral' },
    activity: { runId: 'game', activityId: 'cursor_interest', phaseId: 'reaction', stage: 'exiting',
      startedAtMs: 0, phaseStartedAtMs: 1600, phaseEndsAtMs: 2200 },
    motion: { phase: 'grounded', rootScreenPosition: { x: 400, y: 790 }, velocityPxPerSec: { x: 0, y: 0 }, positionAuthority: 'voluntary' },
    visualIntent: { episodeId: 'reaction', episodeStartedAtMs: 1600,
      kind: outcome === 'caught' ? 'happy_reaction' : 'confused_reaction', category: 'reaction', priority: 'normal',
      interrupt: 'yes', loop: 'bounded', emotionalTone: 'neutral' } };
}
function fixture(assets: NormalizedSpriteManifest = manifest) {
  const body = new PetBodyController({ onBrainState: () => () => {}, postBodyEvent: vi.fn(async () => {}) }, () => 0);
  const resolver = new AssetResolver(assets), resolveClip = vi.spyOn(resolver, 'resolve');
  const render = vi.fn<(state: RenderPresentationState) => void>();
  let frame: (now: number) => void = () => {};
  const skin = new SpriteSkinAdapter({ resolver, createRenderer: () => ({ render, destroy: () => {} }),
    scheduler: { request: callback => { frame = callback; return 1; }, cancel: () => {} } });
  skin.init();
  const accept = (state: BrainStateDTO) => { const snapshot = body.acceptBrainState(state); if (snapshot) skin.update(snapshot.visual); };
  return { body, skin, accept, resolveClip, render, tick: (now: number) => frame(now) };
}
it.each(['caught', 'missed', 'lost_target'] as const)('plays the dedicated six-frame clip for %s through Body and Skin', outcome => {
  const f = fixture(); f.accept(brain(outcome));
  const clip = f.resolveClip.mock.results[0]!.value;
  expect(clip.body.animationKey).toBe(outcome === 'caught' ? 'body_cursor_caught' : 'body_cursor_missed');
  expect(clip.body.frames).toHaveLength(6);
  expect(clip.body.frames.reduce((sum: number, item: { durationMs: number }) => sum + item.durationMs, 0)).toBe(600);
  expect(clip.face).toBeUndefined(); f.skin.destroy();
});
it.each(['caught', 'missed'] as const)('keeps legacy fallback for %s without the new assets', outcome => {
  const assets = { ...manifest, animations: Object.fromEntries(Object.entries(manifest.animations)
    .filter(([key]) => key !== 'body_cursor_caught' && key !== 'body_cursor_missed')) };
  const f = fixture(assets); f.accept(brain(outcome));
  expect(f.resolveClip.mock.results[0]!.value.body.animationKey).toBe(outcome === 'caught' ? 'body_petting' : 'body_scared');
  f.skin.destroy();
});
it.each(['unrelated', 'stale_run', 'settle'] as const)('does not apply game artwork to %s presentation', mode => {
  const f = fixture(), state = brain('caught');
  f.accept({ ...state, activity: mode === 'unrelated' ? null : { ...state.activity!,
    ...(mode === 'stale_run' ? { runId: 'other' } : { phaseId: 'settle' }) } });
  expect(f.resolveClip.mock.results[0]!.value.body.animationKey).toBe('body_petting'); f.skin.destroy();
});
it('preserves frame progress on gaze/revision changes and plays the full 600 ms once', () => {
  const f = fixture(); f.accept(brain('caught'));
  const source = () => {
    const layer = f.render.mock.calls.at(-1)?.[0].layers[0];
    return layer?.visible ? layer.frame.source : undefined;
  };
  f.tick(0); f.tick(250); expect(source()).toContain('body_cursor_caught_02.png');
  f.body.setPupilOffset({ x: 1, y: 0 }); f.skin.update(f.body.getSnapshot()!.visual);
  expect(source()).toContain('body_cursor_caught_02.png');
  f.accept({ ...brain('caught'), revision: 2, sampledAtMs: 1900 });
  f.tick(350); expect(source()).toContain('body_cursor_caught_03.png');
  f.tick(600); expect(source()).toContain('body_cursor_caught_05.png');
  f.tick(1200); expect(source()).toContain('body_cursor_caught_05.png'); f.skin.destroy();
});
