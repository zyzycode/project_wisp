import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { causalStory, flushStory } from './causal-life-story-fixture';
import { observationFixture } from '../application/observation-fixture';
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'wisp-world-opportunity-')); dirs.push(dir);
  let now = () => 0;
  const observation = observationFixture(true, () => now());
  const f = causalStory(path.join(dir, 'memory.sqlite3'), true, true, () => observation.runtime.getComputerContext());
  now = f.now;
  const observe = () => observation.sample();
  return { ...f, observation, observe };
}
it('authorized foreground samples postpone a real source-backed invite until an existing stable opportunity, then persist the actual terminal once', async () => {
  const f = fixture();
  try {
    f.elapse(300000); const source = await f.game(true); expect(source.participation).toBe('user_engaged');
    expect(f.invite?.hasPendingInvitation()).toBe(true);
    f.elapse(300000); f.main.tick(); f.advance(1000);
    f.observation.runtime.enable(); f.observation.runtime.setTimingEnabled(true); f.observe();
    expect(f.invite?.opportunity()).toBe(false);
    for (let i = 0; i < 2; i++) { f.advance(1000); f.observe(); expect(f.invite?.opportunity()).toBe(false); }
    expect(f.social).not.toHaveBeenCalled();
    f.advance(1000); f.observe(); expect(f.observation.runtime.getSettings().timingStatus).toBe('stable');
    f.pulse(); await flushStory(); expect(f.main.getActivityTimeline()?.activityId).toBe('social_bid');
    f.finish(); await flushStory(); expect(f.social).toHaveBeenCalledOnce();
    expect(f.command('readDeferredInvitation', f.utc())).toMatchObject({ ok: true, value: { state: 'completed' } });
    expect(f.observation.generateObservation).not.toHaveBeenCalled();
    expect(f.command('recentCausalLife', 100)).toMatchObject({ ok: true, value: [{ activityRunId: source.activityRunId }] });
  } finally { f.observation.runtime.dispose(); await f.dispose(); }
});
it.each(['revoke', 'episode', 'stale', 'backend', 'helper-failure'] as const)('a late real SQLite claim cannot start after%s and unknown never bypasses presence', async change => {
  const f = fixture();
  try {
    f.elapse(300000); await f.game(true); f.elapse(300000); f.main.tick();
    expect(f.invite?.opportunity()).toBe(false); // Long-gap presence is not fresh positive evidence.
    f.advance(1000);
    f.observation.runtime.enable(); f.observation.runtime.setTimingEnabled(true); f.observe();
    for (let i = 0; i < 3; i++) { f.advance(1000); f.observe(); }
    const claim = f.invitationRepository.claim; let ack: (() => void) | undefined;
    vi.spyOn(f.invitationRepository, 'claim').mockImplementation(async (...args) => {
      const value = await claim(...args); return new Promise(resolve => { ack = () => resolve(value); });
    });
    expect(f.invite?.opportunity()).toBe(true); await flushStory();
    if (change === 'revoke') f.observation.runtime.setTimingEnabled(false);
    if (change === 'episode') { f.advance(1000); f.observation.sample('new-title', 'new-episode'); }
    if (change === 'stale') f.elapse(2501);
    if (change === 'backend') f.observation.runtime.backendUnavailable();
    if (change === 'helper-failure') f.observation.unavailable('bridge_failed');
    ack?.(); await flushStory();
    expect(f.social).not.toHaveBeenCalled();
    expect(f.command('readDeferredInvitation', f.utc())).toMatchObject({ ok: true, value: { state: 'abandoned' } });
  } finally { f.observation.runtime.dispose(); await f.dispose(); }
});
