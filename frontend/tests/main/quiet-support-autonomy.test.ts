import { expect, it, vi } from 'vitest';
import { scenario } from './autonomy-scenario-fixture';

it('keeps manual quiet independent, blocks initiative and allows direct play and calm recovery', () => {
  const blocked = vi.fn(), f = scenario({ attention: 90 }, 0, undefined, undefined, { onUnsolicitedBlocked: blocked });
  f.main.setQuietSupport(true);
  expect(f.main.getAutonomyMode()).toEqual({ quiet: false });
  expect(f.main.getAIEventState()).toMatchObject({ allowed: false, touchAllowed: true });
  expect(blocked).toHaveBeenCalledOnce();
  for (let i = 0; i < 8; i++) { f.advance(100); f.main.handleCursorObservation({ x: 440, y: 790 }); }
  expect(f.main.getActivityTimeline()?.activityId).not.toBe('cursor_interest');
  f.finish(); expect(f.play()).toBe(true); f.finish();
  f.main.setQuietMode(true); f.main.setQuietSupport(false);
  expect(f.main.getAIEventState().allowed).toBe(false);
  expect(f.main.getAutonomyMode()).toEqual({ quiet: true });
  f.main.setQuietMode(false); expect(f.main.getAIEventState().allowed).toBe(true); f.main.dispose();
});
it('cancels an active unsolicited run without negative feedback and prevents late game speech', () => {
  const f = scenario({ attention: 90 }, 0);
  for (let i = 0; i < 8; i++) { f.advance(100); f.main.handleCursorObservation({ x: 440, y: 790 }); }
  const friendship = f.character.getState().relationship.friendship;
  f.main.setQuietSupport(true);
  expect(f.main.getActivityTimeline()?.activityId).not.toBe('cursor_interest');
  expect(f.main.getCursorGamePresentation()?.speech ?? null).toBeNull();
  expect(f.character.getState().relationship.friendship).toBe(friendship);
  f.main.resetSystemIdle(); f.advance(300000); expect(f.main.getAIEventState().allowed).toBe(false); f.main.dispose();
});
