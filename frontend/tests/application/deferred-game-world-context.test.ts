import { expect, it, vi } from 'vitest';
import { DeferredGameInvitationRuntime } from '../../src/application/services/deferred-game-invitation-runtime';
import type { DeferredGameInvitation, IDeferredGameInvitationRepository } from '../../src/application/ports/causal-life.interface';
import type { CurrentComputerContext } from '../../src/application/ports/world-context.interface';
import type { MemoryResult } from '../../src/application/ports/memory-repository.interface';
import { invitationWindow } from '../../src/domain/behavior/deferred-game-invitation';
const createdAt = '2026-11-05T10:00:00.000Z', base = Date.parse(createdAt);
const invitation: DeferredGameInvitation = { id: 'invite', sourceAppRunId: 'app', sourceSequence: 1, createdAt, ...invitationWindow(createdAt), state: 'pending' };
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
function fixture() {
  let computer: CurrentComputerContext = { generation: 1, sampledAtMs: 300000, presence: 'active', foreground: 'stable' };
  let eligible = true;
  const claim = vi.fn<IDeferredGameInvitationRepository['claim']>(async () => ({ ok: true, value: true }));
  const repository: IDeferredGameInvitationRepository = { create: vi.fn(), read: async () => ({ ok: true, value: invitation }), claim, finish: vi.fn<IDeferredGameInvitationRepository['finish']>(async () => ({ ok: true, value: undefined })) };
  const start = vi.fn(() => 'run');
  const runtime = new DeferredGameInvitationRuntime({ repository, context: () => ({ generation: 0 }), wallNow: () => base + 300000,
    monotonicNow: () => 300000, createId: () => 'new', eligible: () => eligible, computerContext: () => computer, start, onOpportunityFinished: vi.fn() });
  return { runtime, claim, repository, start, set: (patch: Partial<CurrentComputerContext>) => { computer = { ...computer, ...patch }; }, block: () => { eligible = false; } };
}
it('fresh settling postpones the pending claim; stable and unknown preserve every existing eligibility gate', async () => {
  const f = fixture(); await f.runtime.restore(); f.set({ foreground: 'settling' });
  expect(f.runtime.opportunity()).toBe(false); expect(f.claim).not.toHaveBeenCalled(); expect(f.runtime.hasPendingInvitation()).toBe(true);
  f.set({ foreground: 'unknown' }); f.block(); expect(f.runtime.opportunity()).toBe(false);
  expect(f.claim).not.toHaveBeenCalled();
  for (const foreground of ['stable', 'unknown'] as const) {
    const allowed = fixture(); await allowed.runtime.restore(); allowed.set({ foreground }); expect(allowed.runtime.opportunity()).toBe(true); await flush();
    expect(allowed.start).toHaveBeenCalledOnce();
  }
});
it('abandons an acknowledged claim after the source/policy generation changes, even when the new context is neutral', async () => {
  const f = fixture(); let ack!: (value: MemoryResult<boolean>) => void;
  f.claim.mockImplementation(() => new Promise(resolve => { ack = resolve; }));
  await f.runtime.restore(); expect(f.runtime.opportunity()).toBe(true);
  f.set({ generation: 2, foreground: 'unknown' }); ack({ ok: true, value: true }); await flush();
  expect(f.start).not.toHaveBeenCalled(); expect(f.repository.finish).toHaveBeenCalledWith('invite', 'abandoned', { generation: 0 });
  expect(f.runtime.opportunity()).toBe(false);
});
it('same-source fresh samples do not invalidate a valid capture, while a settling recheck still vetoes', async () => {
  for (const foreground of ['stable', 'settling'] as const) {
    const f = fixture(); let ack!: (value: MemoryResult<boolean>) => void;
    f.claim.mockImplementation(() => new Promise(resolve => { ack = resolve; }));
    await f.runtime.restore(); f.runtime.opportunity(); f.set({ sampledAtMs: 299999, foreground }); ack({ ok: true, value: true }); await flush();
    expect(f.start).toHaveBeenCalledTimes(foreground === 'stable' ? 1 : 0);
  }
});
