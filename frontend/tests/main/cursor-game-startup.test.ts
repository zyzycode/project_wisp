import { expect, it, vi } from 'vitest';
import { CharacterStateService } from '../../src/application/services/character-state.service';
import { scenario } from './autonomy-scenario-fixture';

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

it('keeps critical fatigue gating with global samples', () => {
  const source = { getCursorScreenPosition: () => ({ x: 440, y: 790 }) };
  const f = scenario({ energy: 35 }, 0, undefined, source);
  for (let i = 0; i < 10; i++) f.advance(100);
  expect(f.main.getActivityTimeline()?.activityId).not.toBe('cursor_interest'); f.main.dispose();
});
