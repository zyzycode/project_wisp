import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { AssetResolver, ManifestLoader, AnimationPlayer, type RenderPresentationState } from '../../src/renderer/render-engine';
import { createSystemAnimationIntent } from '../../src/domain/animation/animation-intent';
import { TechnicalFallbackController } from '../../src/renderer/render-engine/technical-fallback-controller';

function frame(enableContinuousGaze = true): RenderPresentationState {
  const manifest = new ManifestLoader().load(JSON.parse(readFileSync('public/assets/sprites/manifest.json', 'utf8')));
  const resolver = new AssetResolver(manifest, enableContinuousGaze ? { enableContinuousGaze: true } : {});
  const player = new AnimationPlayer({ render: () => {}, destroy: () => {} });
  player.play(resolver.resolve(createSystemAnimationIntent('idle_blink', 'neutral', { expressionHint: 'gaze', gazeDirection: 'up' })), { type: 'until_replaced' });
  return player.getPresentationState()!;
}

it('keeps the original face in production even when generated gaze assets are registered', () => {
  const state = frame(false);
  expect(state.layers.find(layer => layer.id === 'face')?.frame?.source).toContain('face_gaze_02.png');
  expect(state.layers.some(layer => layer.id === 'pupils')).toBe(false);
  const manifest = new ManifestLoader().load(JSON.parse(readFileSync('public/assets/sprites/manifest.json', 'utf8')));
  const clip = new AssetResolver(manifest).resolve(createSystemAnimationIntent('idle_blink'));
  expect(clip.face?.animationKey).toBe('face_happy');
  expect(clip.pupils).toBeUndefined();
});

it('anchors both gaze layers to the current body frame and carries the discrete fallback', () => {
  const state = frame();
  const face = state.layers.find(layer => layer.id === 'face')!;
  const pupils = state.layers.find(layer => layer.id === 'pupils')!;
  expect(face.offset).toEqual(pupils.offset);
  expect(face.pivot).toEqual(pupils.pivot);
  expect(state.gazeFallback?.frame.source).toContain('face_gaze_02.png');
});

it.each(['face', 'pupils'])('falls back as a pair after a physical %s image failure', id => {
  const state = frame(), fallback = new TechnicalFallbackController();
  const failed = state.layers.find(layer => layer.id === id);
  if (!failed?.visible) throw new Error('missing gaze fixture');
  fallback.recordFailed(failed, failed.frame.source);
  const layers = fallback.resolvePresentation(state);
  expect(layers.find(layer => layer.id === 'pupils')).toBeUndefined();
  expect(layers.find(layer => layer.id === 'face')).toEqual(state.gazeFallback);
  expect(layers.find(layer => layer.id === 'base_body')).toEqual(state.layers[0]);
});
