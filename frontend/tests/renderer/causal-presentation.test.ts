import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { AssetResolver, ManifestLoader } from '../../src/renderer/render-engine';
import { createSystemAnimationIntent } from '../../src/domain/animation/animation-intent';
import { causalVisualExpression, directCausalExpression } from '../../src/domain/character/causal-director';

it('projects a current decision through existing idle/pout/curious/happy artwork, with idle fallback for missing expression assets', () => {
  const manifest = new ManifestLoader().load(JSON.parse(readFileSync(path.resolve('public/assets/sprites/manifest.json'), 'utf8')));
  const original = createSystemAnimationIntent('happy_reaction', 'playful', { propHint: 'heart' });
  const gate = { forced: false, awake: true, priority: null };
  for (const [kind, cause, target, face] of [['irritated', 'user_interrupted', 'user', 'face_pout'],
    ['curious', 'contact', 'self', 'face_curious'], ['content', 'completed', 'user', 'face_happy']] as const) {
    const expression = directCausalExpression({ kind, cause, target, activity: cause === 'contact' ? 'contact' : 'cursor_game', causeSequence: 3, intensity: .3 }, false, 'none')!.expression;
    const intent = causalVisualExpression(original, expression, gate);
    const resolved = new AssetResolver(manifest).resolve(intent);
    expect(intent.kind).toBe('idle_blink'); expect(resolved.body.animationKey).toBe('body_idle');
    expect(resolved.face?.animationKey).toBe(face); expect(resolved.props).toBeUndefined();
    const unavailable = { ...manifest, animations: Object.fromEntries(Object.entries(manifest.animations)
      .filter(([key]) => key !== face && key !== 'expression_pout')) };
    const fallback = new AssetResolver(unavailable).resolve(intent);
    expect(fallback.body.animationKey).toBe('body_idle'); expect(fallback.face?.animationKey).not.toBe(face);
  }
  const expression = directCausalExpression({ kind: 'irritated', cause: 'user_interrupted', target: 'user', activity: 'cursor_game', causeSequence: 3, intensity: .3 }, false, 'none')!.expression;
  const walking = createSystemAnimationIntent('idle_blink');
  expect(causalVisualExpression(walking, expression, { ...gate, forced: true })).toBe(walking);
});
