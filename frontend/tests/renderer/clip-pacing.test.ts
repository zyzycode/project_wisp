import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it, vi } from 'vitest';
import { AnimationPlayer, AssetResolver, ManifestLoader } from '../../src/renderer/render-engine';
import type { AnimationIntent } from '../../src/domain/animation/animation-intent';

const manifest = new ManifestLoader().load(JSON.parse(readFileSync(resolve('public/assets/sprites/manifest.json'), 'utf8')));
const resolver = new AssetResolver(manifest);
it('finishes a finite clip within its phase budget with a terminal hold', () => {
  const kind = 'look_around';
  const phaseDurationMs = 2200;
  const result = resolver.resolve({ kind, category: 'idle', priority: 'low', interrupt: 'yes',
    loop: 'none', requestedBy: 'brain', emotionalTone: 'neutral' }, { phaseDurationMs });
  const duration = result.body.frames.reduce((total, frame) => total + (frame.durationMs ?? 0), 0);
  expect(duration).toBeCloseTo(phaseDurationMs * .9);
  const completed = vi.fn();
  const player = new AnimationPlayer({ render: vi.fn(), destroy: vi.fn() });
  player.onCompleted(completed); player.play(result, { type: 'none' });
  player.tick(phaseDurationMs * .95); expect(completed).toHaveBeenCalledOnce();
});
function clip(kind: AnimationIntent['kind']) {
  return resolver.resolve({ kind, category: 'idle', priority: 'low', interrupt: 'yes',
    loop: 'until_replaced', requestedBy: 'brain', emotionalTone: 'neutral' });
}

it('keeps calm body breathing active across a three-second settle phase', () => {
  const settled = clip('settle');
  const completed = vi.fn();
  const player = new AnimationPlayer({ render: vi.fn(), destroy: vi.fn() });
  player.onCompleted(completed);
  player.play(settled, { type: 'none' });
  player.tick(1800);
  expect(completed).not.toHaveBeenCalled();
  player.tick(600);
  expect(completed).toHaveBeenCalledOnce();
  expect(completed.mock.calls[0]?.[0].sessionElapsedMs).toBe(2400);
});

it('does not retime artist supplied custom durations', () => {
  const idle = manifest.animations.body_idle!;
  const custom = new AssetResolver({ ...manifest, animations: { ...manifest.animations,
    body_idle: { ...idle, frames: idle.frames.map(frame => ({ ...frame, durationMs: 350 })) } } });
  const result = custom.resolve({ kind: 'idle_blink', category: 'idle', priority: 'low', interrupt: 'yes',
    loop: 'until_replaced', requestedBy: 'brain', emotionalTone: 'neutral' });
  expect(result.body.frames.map(frame => frame.durationMs)).toEqual([350, 350, 350, 350]);
});
