import { expect, it, vi } from 'vitest';
import { CharacterStateService } from '../../src/application/services/character-state.service';
import { scenario } from './autonomy-scenario-fixture';

it.each([false, true])('starts with real new-character needs and friendship, from calm=%s', calm => {
  const defaults = new CharacterStateService({ now: () => 0 }).getState();
  expect(defaults.relationship.friendship).toBe(0); expect(defaults.needs.play).toBe(30);
  const f = scenario({}, 0, defaults);
  if (calm) { f.pulse(); expect(f.main.getActivityTimeline()?.activityId).toBe('calm'); }
  const sample = () => f.main.handleCursorObservation({ x: f.root().x + 40, y: f.root().y });
  sample();
  for (let i = 0; i < 5; i++) { f.advance(100); sample(); }
  expect(f.main.getActivityTimeline()?.activityId).toBe('cursor_interest');
  for (let i = 0; i < 28; i++) { sample(); f.advance(100); }
  expect(f.outcomes.some(outcome => outcome.family === 'cursor_interest' && outcome.playCompleted)).toBe(true);
  f.main.dispose();
});

it('lets real 10Hz samples build dwell without an earlier gaze activity consuming cooldown', () => {
  const f = scenario({}, 0);
  const sample = () => f.main.handleCursorObservation({ x: 440, y: 790 });
  expect(sample()).toBe(false);
  for (let i = 0; i < 4; i++) { f.advance(100); expect(sample()).toBe(false); }
  expect(f.main.getActivityTimeline()).toBeNull();
  f.advance(100); expect(sample()).toBe(true);
  expect(f.main.getActivityTimeline()?.activityId).toBe('cursor_interest'); f.main.dispose();
});

it('starts and follows global cursor samples without any Renderer pointer event', () => {
  let cursor = { x: 440, y: 790 };
  const source = { getCursorScreenPosition: vi.fn(() => cursor) };
  const f = scenario({}, 0, new CharacterStateService({ now: () => 0 }).getState(), source);
  for (let i = 0; i < 61; i++) f.advance(10);
  expect(source.getCursorScreenPosition).toHaveBeenCalledTimes(7);
  expect(f.main.getActivityTimeline()?.activityId).toBe('cursor_interest');
  cursor = { x: 520, y: 790 };
  for (let i = 0; i < 6; i++) f.advance(100);
  expect(f.main.getActivityTimeline()?.phaseId).toBe('approach_1');
  expect(f.move).toHaveBeenCalled(); f.main.dispose();
  const count = source.getCursorScreenPosition.mock.calls.length; f.advance(1000);
  expect(source.getCursorScreenPosition).toHaveBeenCalledTimes(count);
});

it('does not spend initiative on a global cursor outside the ambient zone', () => {
  let cursor = { x: 900, y: 790 };
  const f = scenario({}, 0, undefined, { getCursorScreenPosition: () => cursor });
  for (let i = 0; i < 50; i++) f.advance(100);
  expect(f.main.getActivityTimeline()).toBeNull();
  cursor = { x: 440, y: 790 };
  for (let i = 0; i < 6; i++) f.advance(100);
  expect(f.main.getActivityTimeline()?.activityId).toBe('cursor_interest'); f.main.dispose();
});

it('loses an unavailable global target and keeps local input fallback when unsupported', () => {
  let cursor: { x: number; y: number } | null = { x: 440, y: 790 };
  const f = scenario({}, 0, undefined, { getCursorScreenPosition: () => cursor });
  for (let i = 0; i < 6; i++) f.advance(100);
  expect(f.main.getActivityTimeline()?.activityId).toBe('cursor_interest');
  cursor = null; f.advance(100);
  expect(f.main.getCursorGamePresentation()?.outcome).toBe('lost_target'); f.main.dispose();
  const fallback = scenario({}, 0, undefined, { getCursorScreenPosition: () => null });
  for (let i = 0; i < 6; i++) { fallback.advance(100); fallback.main.handleCursorObservation({ x: 440, y: 790 }); }
  expect(fallback.main.getActivityTimeline()?.activityId).toBe('observe_cursor');
  expect(fallback.move).not.toHaveBeenCalled(); fallback.main.dispose();
});

it.each(['quiet', 'menu', 'disabled', 'fatigue'] as const)('keeps %s gating with global samples', mode => {
  const source = { getCursorScreenPosition: () => ({ x: 440, y: 790 }) };
  const f = scenario(mode === 'fatigue' ? { energy: 35 } : {}, 0, undefined, source);
  if (mode === 'quiet') f.main.setQuietMode(true);
  if (mode === 'menu') f.main.setMenuOpen(true);
  if (mode === 'disabled') f.main.setEnabled(false);
  for (let i = 0; i < 10; i++) f.advance(100);
  expect(f.main.getActivityTimeline()?.activityId).not.toBe('cursor_interest'); f.main.dispose();
});
