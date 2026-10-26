import { describe, expect, it, vi } from 'vitest';
import { MainCursorObservationState } from '../../src/main/main-cursor-observation-state';
import { MainVisualEpisodeState } from '../../src/main/main-visual-episode-state';

describe('Main presentation state ownership', () => {
  it('retains unique visual replay identity even when the injected suffix repeats', () => {
    let now = 10;
    const episodes = new MainVisualEpisodeState({ now: () => now, tone: () => 'neutral', createId: () => 'same' });
    const initial = episodes.current;
    expect(episodes.set('idle_blink', false)).toBe(false);
    expect(episodes.current).toBe(initial);
    now = 20;
    expect(episodes.set('idle_blink', true)).toBe(true);
    expect(episodes.current).toMatchObject({ id: '2:same', sequence: 2, startedAtMs: 20 });
    expect(initial.id).toBe('1:same');
  });

  it('keeps the native polling cadence and clears a lost source without renewing stale observations', () => {
    const cursor = new MainCursorObservationState();
    const source = { getCursorScreenPosition: vi.fn<() => { x: number; y: number } | null>()
      .mockReturnValueOnce({ x: 100, y: 200 }).mockReturnValue(null) };
    expect(cursor.poll(10, source)).toBe(true);
    cursor.observe({ x: 100, y: 200 }, 10, { x: 100, y: 200 }, true);
    cursor.mustExit = true;
    expect(cursor.poll(109, source)).toBeNull();
    expect(source.getCursorScreenPosition).toHaveBeenCalledTimes(1);
    const copy = cursor.getGlobalSample()!;
    expect(copy).not.toBe(cursor.global);
    expect(copy.globalPosition).not.toBe(cursor.global?.globalPosition);
    expect(cursor.poll(110, source)).toBe(true);
    expect(cursor.latest).toBeNull();
    expect(cursor.getGlobalSample()).toBeNull();
    expect(cursor.globalActive).toBe(false);
    expect(cursor.mustExit).toBe(false);
    expect(cursor.expire(1000, { x: 0, y: 0 })).toBe(false);
  });
});
