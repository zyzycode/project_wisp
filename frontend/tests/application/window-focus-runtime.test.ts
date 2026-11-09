import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WindowFocusRuntime } from '../../src/application/services/window-focus-runtime';
import type { ExternalWindowFocusPort, WindowFocusTarget } from '../../src/application/ports/external-window-focus.port';

const identity = { streamId: 'stream', conversationId: 'conversation', requestId: 'request' };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function fixture() {
  let serial = 0, generation = 1, active = true, signature = 'rectangle';
  const port = {
    prepare: vi.fn<ExternalWindowFocusPort['prepare']>(),
    commit: vi.fn<ExternalWindowFocusPort['commit']>(async () => ({ status: 'success', effect: 'focus_observed' })), dispose: vi.fn(),
  };
  port.prepare.mockImplementation(async (authorization) => ({ status: 'prepared', value: { attemptId: authorization.attemptId, preparedId: 'nonce' } }));
  const options = { now: Date.now, createId: () => `id-${++serial}`, scheduler: { setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms), clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>) },
    capability: () => 'available' as const, context: () => ({ streamId: identity.streamId, conversationId: identity.conversationId, generation }), active: () => active,
    candidates: (policyGeneration: number) => [{ target: { surfaceId: 'surface', sourceEpoch: 2, policyGeneration, geometrySignature: signature, capturedAtMs: Date.now() } satisfies WindowFocusTarget, preview: { left: .1, top: .2, width: .5, height: .4 } }],
    confirm: vi.fn(async () => true), port };
  const runtime = new WindowFocusRuntime(options);
  const choose = async () => { const opened = await runtime.open(identity); if (!opened.ok || !opened.state.selector) throw Error('Missing selector'); return { ...identity, selectorId: opened.state.selector.selectorId, selectionId: opened.state.selector.candidates[0]!.selectionId }; };
  return { runtime, options, port, choose, invalidate: () => { generation++; runtime.invalidate(); }, move: () => { signature = 'moved'; }, quiet: () => { active = false; runtime.invalidate(); } };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1000); });
afterEach(() => vi.useRealTimers());
it('refreshes matching target freshness after human selection instead of authorizing an obsolete sample', async () => {
  const f = fixture(), command = await f.choose(); await vi.advanceTimersByTimeAsync(1200); await f.runtime.choose(command);
  expect(f.port.prepare).toHaveBeenCalledOnce(); expect(f.port.prepare.mock.calls[0]![0].target.capturedAtMs).toBe(2200);
  expect(f.runtime.state().receipt).toMatchObject({ status: 'success' });
});
it('returns the same terminal receipt for duplicate selection without repeating native confirmation or effect', async () => {
  const f = fixture(), command = await f.choose(); const first = await f.runtime.choose(command), duplicate = await f.runtime.choose(command);
  expect(duplicate).toEqual(first); expect(f.options.confirm).toHaveBeenCalledOnce(); expect(f.port.commit).toHaveBeenCalledOnce();
});
it('rejects late native confirmation after selector expiry before preparing any OS action', async () => {
  const f = fixture(), command = await f.choose(), waiting = deferred<boolean>(); f.options.confirm.mockReturnValue(waiting.promise);
  const action = f.runtime.choose(command); await vi.advanceTimersByTimeAsync(30001); waiting.resolve(true); await action;
  expect(f.port.prepare).not.toHaveBeenCalled(); expect(f.port.commit).not.toHaveBeenCalled(); expect(f.runtime.state().receipt).toMatchObject({ status: 'rejected', reason: 'expired' });
});
it('never confirms a forged selector or unsupported request, and target changes cancel before dispatch', async () => {
  const f = fixture(), command = await f.choose();
  expect(await f.runtime.choose({ ...command, selectionId: 'forged' })).toEqual({ ok: false, code: 'invalid_input' });
  f.move(); await f.runtime.choose(command); expect(f.options.confirm).not.toHaveBeenCalled(); expect(f.port.prepare).not.toHaveBeenCalled();
});
it('revoke while prepare is pending prevents commit and late completion cannot restore a success receipt', async () => {
  const f = fixture(), command = await f.choose(), waiting = deferred<Awaited<ReturnType<typeof f.port.prepare>>>();
  f.port.prepare.mockReturnValue(waiting.promise); const work = f.runtime.choose(command);
  await vi.advanceTimersByTimeAsync(0); f.invalidate();
  waiting.resolve({ status: 'prepared', value: { attemptId: 'id-3', preparedId: 'nonce' } }); await work;
  expect(f.port.commit).not.toHaveBeenCalled(); expect(f.runtime.state().receipt).toBeNull();
});
it('cancel after dispatch reports unknown once; late OS success cannot overwrite it or repeat the effect', async () => {
  const f = fixture(), command = await f.choose(), waiting = deferred<Awaited<ReturnType<typeof f.port.commit>>>();
  f.port.commit.mockReturnValue(waiting.promise); const work = f.runtime.choose(command); await vi.advanceTimersByTimeAsync(0);
  const cancelled = await f.runtime.cancel(identity); expect(cancelled).toMatchObject({ state: { receipt: { status: 'unknown', reason: 'cancelled_after_dispatch' } } });
  waiting.resolve({ status: 'success', effect: 'focus_observed' }); await work;
  expect(f.runtime.state().receipt).toMatchObject({ status: 'unknown' }); expect(f.port.commit).toHaveBeenCalledOnce();
});
it('bounds action deadline/terminal retention and disposes without restoring grants', async () => {
  const f = fixture(), command = await f.choose(); f.port.commit.mockReturnValue(new Promise(() => undefined));
  const work = f.runtime.choose(command); await vi.advanceTimersByTimeAsync(5001); await work;
  expect(f.runtime.state().receipt).toMatchObject({ status: 'unknown', reason: 'timeout_after_dispatch' });
  await vi.advanceTimersByTimeAsync(60001); expect(f.runtime.state().receipt).toBeNull();
  f.runtime.dispose(); f.runtime.dispose(); expect(f.runtime.state().selector).toBeNull(); expect(vi.getTimerCount()).toBe(0);
});
