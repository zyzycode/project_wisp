import { expect, it, vi } from 'vitest';
import { PassThrough, Writable } from 'node:stream';
import { createDesktopDiagnostics } from '../../src/infrastructure/logging/desktop-diagnostics';
import { DiagnosticOutput } from '../../src/infrastructure/logging/diagnostic-output';
import { desktopLogPolicy, backendLogPolicy } from '../../src/infrastructure/logging/diagnostic-config';

function output() {
  const stream = new PassThrough(), lines: string[] = [];
  const write = vi.spyOn(stream, 'write').mockImplementation((value, encoding, callback) => {
    lines.push(String(value));
    const complete = typeof encoding === 'function' ? encoding : callback;
    complete?.(null);
    return true;
  });
  return { stream, lines, write };
}
it('uses independent strict process switches with quiet defaults and no rejected-value echo', () => {
  expect(desktopLogPolicy(undefined)).toEqual({ level: 'warn', invalid: false });
  expect(backendLogPolicy(undefined)).toEqual({ level: 'WARNING', invalid: false });
  for (const level of ['debug', 'info', 'warn', 'error', 'silent']) expect(desktopLogPolicy(level)).toEqual({ level, invalid: false });
  for (const level of ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL', 'OFF']) expect(backendLogPolicy(level)).toEqual({ level, invalid: false });
  const f = output(), diagnostics = createDesktopDiagnostics({ WISP_DESKTOP_LOG_LEVEL: 'secret-rejected', WISP_LOG_LEVEL: 'secret-rejected' }, { output: f.stream });
  expect(diagnostics.logger.getLevel()).toBe('warn'); expect(f.lines).toHaveLength(1);
  expect(f.lines[0]).toContain('logging_configuration_invalid'); expect(f.lines[0]).not.toContain('secret-rejected');
  diagnostics.dispose();
});
it.each(['debug', 'info', 'warn', 'error', 'silent'])('applies %s to both output and the existing bounded buffer', level => {
  const f = output(), diagnostics = createDesktopDiagnostics({ WISP_DESKTOP_LOG_LEVEL: level }, { output: f.stream });
  diagnostics.logger.debug('IPC', 'desktop_services_initialized'); diagnostics.logger.info('IPC', 'desktop_started');
  diagnostics.logger.warn('IPC', 'ai_connection_unavailable'); diagnostics.logger.error('IPC', 'desktop_startup_failed');
  const expected = ['debug', 'info', 'warn', 'error'].slice(['debug', 'info', 'warn', 'error', 'silent'].indexOf(level));
  expect(f.lines.map(line => JSON.parse(line).level)).toEqual(expected);
  expect(diagnostics.logger.getBufferedEntries().map(entry => entry.level)).toEqual(expected);
  for (let index = 0; index < 150; index++) diagnostics.logger.error('IPC', 'desktop_startup_failed');
  expect(diagnostics.logger.getBufferedEntries()).toHaveLength(level === 'silent' ? 0 : 100);
  diagnostics.dispose();
});
it('projects static desktop events without raw metadata and throttles Brain delivery failures without catch-up', () => {
  const f = output(); let now = 100;
  const diagnostics = createDesktopDiagnostics({ WISP_DESKTOP_LOG_LEVEL: 'debug' }, { output: f.stream, now: () => now });
  diagnostics.logger.warn('IPC', 'brain_delivery_failed', { error: 'secret-path-dialogue', apiKey: 'synthetic-secret' });
  diagnostics.logger.error('IPC', 'unknown-secret-message');
  expect(f.lines).toHaveLength(1); expect(f.lines[0]).not.toContain('secret');
  expect(JSON.parse(f.lines[0]!).timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/u);
  f.lines.length = 0;
  diagnostics.brainDeliveryFailed(); now = 1099; diagnostics.brainDeliveryFailed();
  expect(f.lines).toHaveLength(1); now = 1100; diagnostics.brainDeliveryFailed();
  expect(f.lines).toHaveLength(2); now = 10_000; diagnostics.brainDeliveryFailed();
  expect(f.lines).toHaveLength(3); diagnostics.dispose();
});
it('drops backpressured output until drain and disables a failing sink without affecting runtime', () => {
  const f = output(), sink = new DiagnosticOutput(f.stream);
  f.write.mockImplementationOnce((value, encoding, callback) => {
    f.lines.push(String(value));
    (typeof encoding === 'function' ? encoding : callback)?.(null);
    return false;
  });
  sink.write({ event: 'one' }); sink.write({ event: 'dropped' }); expect(f.write).toHaveBeenCalledTimes(1);
  f.stream.emit('drain'); sink.write({ event: 'two' }); expect(f.write).toHaveBeenCalledTimes(2);
  expect(() => f.stream.emit('error', new Error('synthetic secret'))).not.toThrow();
  sink.write({ event: 'disabled' }); expect(f.write).toHaveBeenCalledTimes(2);
  sink.dispose(); expect(f.stream.listenerCount('drain')).toBe(0); expect(f.stream.listenerCount('error')).toBe(0);
  sink.write({ event: 'retired' }); expect(f.write).toHaveBeenCalledTimes(2);
});
it('does not retry synchronous output failures or oversized records', () => {
  const f = output(), sink = new DiagnosticOutput(f.stream);
  sink.write({ event: 'x'.repeat(4096) }); expect(f.write).not.toHaveBeenCalled();
  f.write.mockImplementationOnce(() => { throw new Error('synthetic secret'); });
  expect(() => sink.write({ event: 'one' })).not.toThrow(); sink.write({ event: 'two' });
  expect(f.write).toHaveBeenCalledOnce(); sink.dispose();
});
it('keeps a pending real Writable failure nonfatal after disposal and then releases listeners', async () => {
  let complete!: (error?: Error | null) => void;
  const stream = new Writable({ write(_chunk, _encoding, callback) { complete = callback; } });
  const sink = new DiagnosticOutput(stream);
  sink.write({ event: 'desktop_started' }); sink.dispose();
  expect(stream.listenerCount('drain')).toBe(0);
  complete(new Error('synthetic private output failure'));
  await new Promise<void>(resolve => setImmediate(resolve));
  expect(stream.listenerCount('error')).toBe(0);
});
it('releases the retirement error guard after a pending real Writable completes successfully', async () => {
  let complete!: (error?: Error | null) => void;
  const stream = new Writable({ write(_chunk, _encoding, callback) { complete = callback; } });
  const sink = new DiagnosticOutput(stream);
  sink.write({ event: 'desktop_started' }); sink.dispose();
  expect(stream.listenerCount('error')).toBe(1);
  complete(); await new Promise<void>(resolve => setImmediate(resolve));
  expect(stream.listenerCount('error')).toBe(0);
});
