import { describe, expect, it } from 'vitest';
import { selectLocalActivity } from '../../src/domain/behavior/local-activity-policy';

const snapshot = { needs: { energy: 50, attention: 20, play: 20, comfort: 50 }, synthesizedTone: 'neutral' as const };
const context = { nowMs: 1000, canExplore: false, canPlay: false, canRest: false, history: [] };
const poses = (history: { kind: string; atMs: number }[]) => Array.from({ length: 100 }, (_, i) =>
  selectLocalActivity(snapshot, { ...context, history }, i / 100).intent.calmPose);
describe('local calm variation', () => {
  it('keeps both calm poses eligible instead of forcing alternation', () => {
    expect(new Set(poses([{ kind: 'calm:look_around', atMs: 1000 }]))).toEqual(new Set(['idle_blink', 'look_around']));
  });
  it('softly reduces recent gestures and recovers their weight with age', () => {
    const count = (history: { kind: string; atMs: number }[]) => poses(history).filter(p => p === 'look_around').length;
    expect(count([{ kind: 'calm:look_around', atMs: 1000 }])).toBeLessThan(count([]));
    expect(count([{ kind: 'calm:look_around', atMs: -900000 }])).toBe(count([]));
  });
});
