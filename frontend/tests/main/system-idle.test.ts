import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { MainSystemIdle } from '../../src/main/main-system-idle';
import type { SystemIdleLifecycleEvent, SystemIdlePort, SystemIdleReading } from '../../src/application/ports/system-idle.port';

function fixture() {
  let mono = 0, reading: SystemIdleReading = { status: 'available', idleMs: 1000 };
  const callbacks: ((event: SystemIdleLifecycleEvent) => void)[] = [];
  const unsubscribe = vi.fn(), blocked = vi.fn();
  const source: SystemIdlePort = { read: vi.fn(() => reading), dispose: vi.fn(), subscribeLifecycle: callback => {
    callbacks.push(callback); return unsubscribe; } };
  const controller = new MainSystemIdle({ source, now: () => mono, wallNow: Date.now, onBlocked: blocked });
  const advance = (ms = 1000, arming = true) => { mono += ms; vi.setSystemTime(Date.now() + ms); return controller.tick(arming); };
  const sample = (idleMs: number, ms = 1000, arming = true) => { reading = { status: 'available', idleMs }; return advance(ms, arming); };
  const away = () => { controller.tick(true); for (let seconds = 2; seconds <= 301; seconds++) sample(seconds * 1000); };
  return { controller, source, blocked, unsubscribe, callbacks, sample, advance, away,
    setReading: (value: SystemIdleReading) => { reading = value; },
    setMono: (value: number) => { mono = value; }, lifecycle: (event: SystemIdleLifecycleEvent) => callbacks.at(-1)?.(event) };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1000000); });
afterEach(() => vi.useRealTimers());

describe('bounded Main system idle lifecycle', () => {
  it('reads no more than once per second and never catches up a paused tick', () => {
    const f = fixture(); f.controller.tick(true); f.advance(999); expect(f.source.read).toHaveBeenCalledTimes(1);
    f.advance(1); expect(f.source.read).toHaveBeenCalledTimes(2); f.advance(10000);
    expect(f.source.read).toHaveBeenCalledTimes(3); f.controller.dispose();
  });
  it('expires cached away before admission without another read', () => {
    const f = fixture(); f.away(); expect(f.controller.isBlocked()).toBe(true);
    f.setMono(302501); expect(f.controller.isBlocked()).toBe(false); f.controller.dispose();
  });
  it('emits a consumed return once and does not infer absence from startup history', () => {
    const f = fixture(); f.away(); expect(f.sample(1000)).toBe(true); expect(f.sample(2000)).toBe(false);
    f.controller.reset(); f.sample(301000); f.sample(302000); expect(f.sample(1000)).toBe(false); f.controller.dispose();
  });
  it.each(['suspend', 'session_deactivated'] as const)('pauses native reads on %s and never treats resume as return', event => {
    const f = fixture(); f.away(); f.lifecycle(event); const reads = vi.mocked(f.source.read).mock.calls.length;
    f.advance(10000); expect(f.source.read).toHaveBeenCalledTimes(reads); expect(f.controller.isBlocked()).toBe(true);
    f.lifecycle(event === 'suspend' ? 'resume' : 'session_activated'); expect(f.sample(1000)).toBe(false);
    expect(f.controller.isBlocked()).toBe(false); f.controller.dispose();
  });
  it('allows bounded polling to recover a query-observed lock without unlock event', () => {
    const f = fixture(); f.away(); f.setReading({ status: 'unavailable', reason: 'inactive_session' });
    f.advance(); expect(f.controller.isBlocked()).toBe(true);
    f.setReading({ status: 'unavailable', reason: 'read_failed' }); f.advance();
    expect(f.controller.isBlocked()).toBe(true);
    expect(f.sample(1000)).toBe(false); expect(f.controller.isBlocked()).toBe(false); f.controller.dispose();
  });
  it('invalidates zero after TTL, errors, wall jumps, and backwards monotonic clocks', () => {
    const f = fixture(); f.away(); f.setReading({ status: 'unavailable', reason: 'unconfirmed' });
    f.advance(); expect(f.controller.isBlocked()).toBe(false); expect(f.sample(1000)).toBe(true);
    f.away(); f.setReading({ status: 'unavailable', reason: 'unconfirmed' }); f.advance(3000);
    expect(f.sample(1000)).toBe(false);
    f.setReading({ status: 'unavailable', reason: 'read_failed' }); f.advance(); expect(f.sample(1000)).toBe(false);
    vi.setSystemTime(Date.now() + 10000); expect(f.sample(1000)).toBe(false);
    f.setMono(-1); expect(f.controller.tick(true)).toBe(false); expect(f.controller.isBlocked()).toBe(false);
    f.controller.dispose();
  });
  it('disarms on quiet, disable/reset and rejects callbacks from prior generations or dispose', () => {
    const f = fixture(); f.away(); expect(f.sample(1000, 1000, false)).toBe(false);
    const old = f.callbacks[0]; f.controller.reset(); old?.('suspend'); expect(f.controller.isBlocked()).toBe(false);
    f.controller.setEnabled(false); const reads = vi.mocked(f.source.read).mock.calls.length; f.advance();
    expect(f.source.read).toHaveBeenCalledTimes(reads); f.controller.setEnabled(true); expect(f.sample(1000)).toBe(false);
    const latest = f.callbacks.at(-1); f.controller.dispose(); f.controller.dispose(); latest?.('suspend');
    f.advance(); expect(f.controller.isBlocked()).toBe(false); expect(f.source.dispose).toHaveBeenCalledOnce();
    expect(f.unsubscribe).toHaveBeenCalled();
  });
});
