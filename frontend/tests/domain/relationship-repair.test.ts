import { expect, it } from 'vitest';
import { canRepair, emptyRepairCheckpoint, restoreRepairClock, acknowledgeRepairInterruption, type RepairEpisode } from '../../src/domain/character/relationship-repair';
const base = Date.parse('2026-11-05T10:00:00.000Z');
const interrupted: RepairEpisode = { appRunId: 'prior', sequence: 2, revision: 1, occurredAt: new Date(base).toISOString(),
  source: 'user', triggerSequence: 1, activityRunId: 'game', activity: 'cursor_game', cause: 'user_interrupted', outcome: 'cancelled', executedMs: 1500, participation: 'user_engaged' };
const completed = (wall: number): RepairEpisode => ({ ...interrupted, appRunId: 'current', sequence: 3, occurredAt: new Date(wall).toISOString(),
  source: 'autonomy', triggerSequence: null, activityRunId: 'newgame', cause: 'completed', outcome: 'completed' });
it('restores only remaining cooldown windows and never treats offline time as an experience', () => {
  const checkpoint = acknowledgeRepairInterruption(emptyRepairCheckpoint(), interrupted, 0, base, 0).checkpoint;
  const clock = restoreRepairClock(checkpoint, base + 120000, 1000, base + 60000);
  expect(clock.interruptionReady).toBe(181000);
  expect(canRepair(checkpoint, clock, interrupted, completed(base + 299999), 2, base + 299999, 180999)).toBe(false);
  expect(canRepair(checkpoint, clock, interrupted, completed(base + 300000), 2, base + 300000, 181000)).toBe(true);
  expect(checkpoint.lastRepairAt).toBeNull();
  const repair = { ...checkpoint, lastRepairAt: new Date(base + 300000).toISOString(), lastRepairSource: { appRunId: 'old', sequence: 8, revision: 1 as const } };
  const resumed = restoreRepairClock(repair, base + 360000, 10, base + 350000);
  expect(resumed.repairReady).toBe(240010);
  expect(canRepair(repair, resumed, interrupted, completed(base + 599999), 2, base + 599999, 240009)).toBe(false);
});
it.each(['missing', 'wrong-ref', 'wrong-time', 'wrong-cause', 'short', 'solitary', 'zero-resentment', 'expired'] as const)('omits repair with %s evidence', variant => {
  const checkpoint = acknowledgeRepairInterruption(emptyRepairCheckpoint(), interrupted, 0, base, 0).checkpoint;
  const clock = restoreRepairClock(checkpoint, base, 0);
  const proof = variant === 'missing' ? null : { ...interrupted,
    ...(variant === 'wrong-ref' ? { sequence: 99 } : {}), ...(variant === 'wrong-time' ? { occurredAt: new Date(base + 1).toISOString() } : {}),
    ...(variant === 'wrong-cause' ? { cause: 'unknown' as const } : {}) };
  const wall = base + (variant === 'expired' ? 86400000 : 300000);
  const event = { ...completed(wall), ...(variant === 'short' ? { executedMs: 999 } : {}), ...(variant === 'solitary' ? { participation: 'solitary' as const } : {}) };
  expect(canRepair(checkpoint, clock, proof, event, variant === 'zero-resentment' ? 0 : 2, wall, wall - base)).toBe(false);
});
it('quarantines future markers, backwards wall time and invalid monotonic clocks', () => {
  const checkpoint = acknowledgeRepairInterruption(emptyRepairCheckpoint(), interrupted, 0, base, 0).checkpoint;
  expect(restoreRepairClock(checkpoint, base - 1, 0).quarantined).toBe(true);
  expect(restoreRepairClock(checkpoint, base + 100, 0, base + 101).quarantined).toBe(true);
  expect(restoreRepairClock(checkpoint, base, -1).quarantined).toBe(true);
});
