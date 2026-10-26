import { describe, expect, it } from 'vitest';
import { scenario } from './autonomy-scenario-fixture';

describe('direct reactions without autonomy or Skin completion', () => {
  it('finishes a direct reaction on the Brain clock', () => {
    const f = scenario();
    f.main.setEnabled(false);
    f.main.handleCharacterInteraction('click');
    expect(f.main.getVisualEpisode().intent.kind).toBe('happy_reaction');
    f.advance(3000);
    expect(f.main.getVisualEpisode().intent.kind).toBe('idle_blink');
    f.main.dispose();
  });

  it('gives a repeated click its own deadline and cancels it on drag', () => {
    const f = scenario();
    f.main.setEnabled(false);
    f.main.handleClick();
    f.advance(2999);
    f.main.handleClick();
    f.advance(1);
    expect(f.main.getVisualEpisode().intent.kind).toBe('happy_reaction');
    f.main.handleMotionEvent({ type: 'drag_started', atMs: f.now() });
    f.advance(3000);
    expect(f.main.getVisualEpisode().intent.kind).toBe('dragged');
    f.main.dispose();
  });

  it('finishes waking without a new autonomous opportunity', () => {
    const f = scenario();
    f.main.setEnabled(false);
    f.main.requestSleepWake({ action: 'sleep' });
    f.main.requestSleepWake({ action: 'wake' });
    expect(f.main.getVisualEpisode().intent.kind).toBe('wake_up');
    f.advance(1500);
    expect(f.main.getVisualEpisode().intent.kind).toBe('idle_blink');
    f.main.dispose();
  });

  it.each([['soft_landing', 800], ['crash_landing', 1600]] as const)(
    'finishes %s with autonomy disabled', (outcome, duration) => {
      const f = scenario();
      f.main.setEnabled(false);
      f.main.handleMotionEvent({ type: 'landed', outcome, impactSeverity: 10 });
      f.advance(duration - 1);
      expect(f.main.getVisualEpisode().intent.kind).toBe(outcome === 'crash_landing' ? 'crash_landing' : 'land');
      f.advance(1);
      expect(f.main.getVisualEpisode().intent.kind).toBe('settle');
      f.main.dispose();
    }
  );
});
