import { expect, it, vi } from 'vitest';
import { WindowsWindowFocus } from '../../src/infrastructure/platform/windows-window-focus';
import type { FocusBridgeCommand, FocusBridgeTarget } from '../../src/infrastructure/platform/window-focus-protocol';
import type { WindowFocusAuthorization, WindowFocusOutcome } from '../../src/application/ports/external-window-focus.port';
const id = 'a'.repeat(32), nonce = 'b'.repeat(32);
function fixture() {
  let now = 1000, generation = 2;
  let target: FocusBridgeTarget | undefined = { token: 'c'.repeat(32), signature: 'rectangle', x: 1, y: 2, width: 3, height: 4 };
  const exchange = vi.fn(async (command: FocusBridgeCommand, _signal: AbortSignal): Promise<{ status: 'prepared'; preparedId: string } | WindowFocusOutcome> => command.action === 'prepare' ? { status: 'prepared', preparedId: nonce } : { status: 'success', effect: 'focus_observed' });
  const port = new WindowsWindowFocus({ now: () => now, createId: () => id, generation: () => generation, lookup: () => target, exchange });
  const authorization: WindowFocusAuthorization = { attemptId: 'attempt', confirmationId: 'confirm', context: { streamId: 'stream', conversationId: 'conversation', requestId: 'request', generation: 3 }, target: { surfaceId: 'surface', sourceEpoch: 2, policyGeneration: 1, geometrySignature: 'rectangle', capturedAtMs: 1000 }, authorizedAtMs: 1000, expiresAtMs: 6000 };
  return { port, authorization, exchange, expire: () => { now = 7000; }, change: () => { generation++; target = undefined; } };
}
it('same-helper prepare/commit consumes one nonce, and repeats receive terminal without another side effect', async () => {
  const f = fixture(), signal = new AbortController().signal, prepared = await f.port.prepare(f.authorization, signal);
  if (prepared.status !== 'prepared') throw Error('Missing preparation');
  const outcome = await f.port.commit(f.authorization, prepared.value, signal);
  expect(outcome).toEqual({ status: 'success', effect: 'focus_observed' });
  expect(await f.port.commit(f.authorization, prepared.value, signal)).toEqual(outcome);
  expect(f.exchange.mock.calls.map(call => call[0].action)).toEqual(['prepare', 'commit']);
});
it.each(['expiry', 'identity', 'auth', 'abort'] as const)('revalidates %s after preparation without committing', async reason => {
  const f = fixture(), controller = new AbortController(), prepared = await f.port.prepare(f.authorization, controller.signal);
  if (prepared.status !== 'prepared') throw Error('Missing preparation');
  if (reason === 'expiry') f.expire(); if (reason === 'identity') f.change(); if (reason === 'abort') controller.abort();
  const authorization = reason === 'auth' ? { ...f.authorization, confirmationId: 'changed-confirmation' } : f.authorization;
  expect((await f.port.commit(authorization, prepared.value, controller.signal)).status).toBe('rejected'); expect(f.exchange).toHaveBeenCalledOnce();
});
it('nonce forgery is rejected and consumes local preparation before any irreversible dispatch', async () => {
  const f = fixture(), signal = new AbortController().signal, prepared = await f.port.prepare(f.authorization, signal);
  if (prepared.status !== 'prepared') throw Error('Missing preparation');
  expect(await f.port.commit(f.authorization, { ...prepared.value, preparedId: 'forged' }, signal)).toMatchObject({ status: 'rejected' });
  expect(await f.port.commit(f.authorization, prepared.value, signal)).toMatchObject({ status: 'rejected' }); expect(f.exchange).toHaveBeenCalledOnce();
});
it('lost bridge or cancellation after commit never invents success or retries', async () => {
  const f = fixture(), controller = new AbortController(), prepared = await f.port.prepare(f.authorization, controller.signal);
  if (prepared.status !== 'prepared') throw Error('Missing preparation');
  f.exchange.mockImplementationOnce(async () => { controller.abort(); return { status: 'success', effect: 'focus_observed' }; });
  expect(await f.port.commit(f.authorization, prepared.value, controller.signal)).toMatchObject({ status: 'unknown', reason: 'cancelled_after_dispatch' }); expect(f.exchange).toHaveBeenCalledTimes(2);
});
it('releases prepared authority when its request ends before commit; an old nonce cannot consume the next grant', async () => {
  const f = fixture(), old = new AbortController(), first = await f.port.prepare(f.authorization, old.signal);
  if (first.status !== 'prepared') throw Error('Missing preparation'); old.abort();
  const next = { ...f.authorization, attemptId: 'next-attempt', confirmationId: 'next-confirmation' }, signal = new AbortController().signal;
  const second = await f.port.prepare(next, signal); expect(second.status).toBe('prepared');
  if (second.status !== 'prepared') throw Error('Missing next preparation');
  expect(await f.port.commit(f.authorization, first.value, old.signal)).toMatchObject({ status: 'rejected' });
  expect(await f.port.commit(next, second.value, signal)).toMatchObject({ status: 'success' });
});
