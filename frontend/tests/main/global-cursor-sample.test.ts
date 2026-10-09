import { describe, expect, it, vi } from 'vitest';
import { scenario } from './autonomy-scenario-fixture';

describe('global cursor presentation sample', () => {
  it('samples with autonomy disabled or a menu open without starting a reaction', () => {
    const getCursorScreenPosition = vi.fn(() => ({ x: 100, y: 200 }));
    const f = scenario({}, .2, undefined, { getCursorScreenPosition });
    f.main.setEnabled(false);
    f.main.setMenuOpen(true);
    f.advance(10);
    expect(f.main.getGlobalCursorSample()).toEqual({ globalPosition: { x: 100, y: 200 }, capturedAtMs: 10 });
    f.advance(50);
    expect(f.main.getGlobalCursorSample()?.capturedAtMs).toBe(10);
    expect(getCursorScreenPosition).toHaveBeenCalledTimes(1);
    expect(f.main.getActivityTimeline()).toBeNull();
    f.advance(50);
    expect(f.main.getGlobalCursorSample()?.capturedAtMs).toBe(110);
    f.main.dispose();
    expect(f.main.getGlobalCursorSample()).toBeNull();
  });

  it('clears a lost cursor source instead of refreshing the last known sample', () => {
    const getCursorScreenPosition = vi.fn<() => { x: number; y: number } | null>()
      .mockReturnValueOnce({ x: 100, y: 200 }).mockReturnValue(null);
    const f = scenario({}, .2, undefined, { getCursorScreenPosition });
    f.main.setEnabled(false);
    f.advance(1);
    expect(f.main.getGlobalCursorSample()).not.toBeNull();
    f.advance(100);
    expect(f.main.getGlobalCursorSample()).toBeNull();
    f.main.dispose();
  });
});
