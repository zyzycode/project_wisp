import { expect, it, vi } from 'vitest';
import { MainSystemIdle } from '../../src/main/main-system-idle';
import type { SystemIdleLifecycleEvent, SystemIdleReading } from '../../src/application/ports/system-idle.port';
function fixture() {
  let now = 0, listener: ((event: SystemIdleLifecycleEvent) => void) | undefined;
  let reading: SystemIdleReading = { status: 'available', idleMs: 1000 };
  const sample = vi.fn(), boundary = vi.fn(), clockDiscontinuity = vi.fn(), read = vi.fn(() => reading);
  const controller = new MainSystemIdle({ source: { read, subscribeLifecycle: callback => { listener = callback; return () => {}; }, dispose: vi.fn() },
    now: () => now, wallNow: () => 1_000_000 + now, onBlocked: vi.fn(),
    routine: { sample, boundary, clockDiscontinuity }, calendar: () => ({ zoneId: 'UTC', offsetMinutes: 0, localDate: '1970-01-01' }) });
  return { controller, sample, boundary, clockDiscontinuity, read, setNow: (value: number) => { now = value; }, tick: () => { now += 1000; return controller.tick(true); },
    reading: (value: SystemIdleReading) => { reading = value; }, lifecycle: (event: SystemIdleLifecycleEvent) => listener?.(event) };
}
it('uses the same bounded read with disabled autonomy, without arming return', () => {
  const f = fixture(); f.controller.setEnabled(false); f.tick(); f.controller.tick(true);
  expect(f.read).toHaveBeenCalledOnce(); expect(f.sample).toHaveBeenCalledOnce();
  for (let n = 2; n <= 303; n++) { f.reading({ status: 'available', idleMs: n * 1000 }); expect(f.tick()).toBe(false); }
  f.reading({ status: 'available', idleMs: 1000 }); expect(f.tick()).toBe(false);
  expect(f.sample).toHaveBeenLastCalledWith(expect.objectContaining({ positiveAvailable: true }), 'available');
});
it('ordinary errors and AFK quiet/menu resets invalidate sample pairs without recording flush', () => {
  const f = fixture(); f.tick(); f.controller.reset();
  for (let n = 0; n < 20; n++) { f.reading({ status: 'unavailable', reason: 'read_failed' }); f.tick(); }
  expect(f.boundary).not.toHaveBeenCalled();
  expect(f.sample).toHaveBeenLastCalledWith(expect.objectContaining({ positiveAvailable: false, presence: 'unknown' }), 'unknown');
});
it('flushes lifecycle boundaries, pauses capture while suspended and rejects old lifecycle callbacks', () => {
  const f = fixture(); f.tick(); f.lifecycle('suspend'); f.tick();
  expect(f.sample).toHaveBeenCalledOnce(); expect(f.boundary).toHaveBeenCalledOnce();
  f.lifecycle('resume'); f.tick(); expect(f.sample).toHaveBeenCalledTimes(2);
  f.controller.dispose(); f.controller.dispose(); f.tick(); expect(f.sample).toHaveBeenCalledTimes(2);
});
it('a lock discovered by scalar reading closes capture while unsupported stays unknown evidence', () => {
  const f = fixture(); f.tick(); f.reading({ status: 'unavailable', reason: 'inactive_session' }); f.tick();
  expect(f.boundary).toHaveBeenCalledOnce();
  f.reading({ status: 'unavailable', reason: 'unsupported' }); f.tick();
  expect(f.sample).toHaveBeenLastCalledWith(expect.objectContaining({ positiveAvailable: false }), 'unsupported');
});

it('forwards a rejected backwards monotonic excursion even when time recovers before the next sample', () => {
  const f = fixture(); f.setNow(10000); f.controller.tick(true);
  f.setNow(9000); f.controller.tick(true); expect(f.clockDiscontinuity).toHaveBeenCalledOnce();
  f.setNow(11000); f.controller.tick(true); expect(f.sample).toHaveBeenCalledTimes(2);
});
