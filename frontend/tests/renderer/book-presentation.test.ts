import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { AssetResolver, ManifestLoader } from '../../src/renderer/render-engine';
import { createSystemAnimationIntent } from '../../src/domain/animation/animation-intent';
import { causalVisualExpression } from '../../src/domain/character/causal-director';

it('uses ready sit/idle fallback without drawing a substitute book and removes props on the next phase', () => {
  const manifest = new ManifestLoader().load(JSON.parse(readFileSync(path.resolve('public/assets/sprites/manifest.json'), 'utf8')));
  const resolver = new AssetResolver(manifest);
  for (const phase of ['book_settle', 'book_with_book', 'book_finish'] as const) {
    const intent = createSystemAnimationIntent(phase, 'neutral', { propHint: phase === 'book_with_book' ? 'book' : 'none' });
    const resolved = resolver.resolve(intent);
    expect(['body_sit', 'body_idle']).toContain(resolved.body.animationKey);
    expect(resolved.props).toBeUndefined();
  }
  expect(resolver.resolve(createSystemAnimationIntent('idle_blink', 'neutral', { propHint: 'book' })).props).toBeUndefined();
});
it('keeps the semantic with-book request while applying only the existing safe affect overlay', () => {
  const intent = createSystemAnimationIntent('book_with_book', 'neutral', { propHint: 'book' });
  const expression = { activity: 'book', intent: 'acknowledge', emotion: 'content', intensity: 'low', target: 'self',
    cause: 'completed', deferredInvitation: false, ownActivityInterest: 'none' } as const;
  expect(causalVisualExpression(intent, expression, { forced: false, awake: true, priority: 'P4_autonomous' }))
    .toMatchObject({ kind: 'book_with_book', propHint: 'book', expressionHint: 'happy' });
  expect(causalVisualExpression(intent, expression, { forced: true, awake: true, priority: 'P4_autonomous' })).toBe(intent);
});
