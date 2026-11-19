import { expect, it, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import { attachBackendDiagnostics } from '../../src/infrastructure/logging/backend-diagnostics';
import { createDesktopDiagnostics } from '../../src/infrastructure/logging/desktop-diagnostics';
import type { DiagnosticRecord } from '../../src/infrastructure/logging/diagnostic-output';

const line = (extra: Record<string, unknown> = {}) => Buffer.from(`${JSON.stringify({ event: 'http_finished', level: 'INFO', ...extra })}\n`);
function fixture() {
  const stream = new PassThrough(), records: DiagnosticRecord[] = []; let now = 0;
  const dispose = attachBackendDiagnostics(stream, value => records.push(value), () => now);
  return { stream, records, dispose, at: (at: number) => { now = at; } };
}
it('reprojects closed events and metadata without raw source, timestamp, module, error or nested data', () => {
  const f = fixture();
  f.stream.emit('data', line({ source: 'secret-source', timestamp: 'secret-time', module: 'secret-module',
    message: 'secret-dialogue', error: { path: '/secret' }, unknown: 'secret',
    context: { correlation_id: 'a'.repeat(32), method: 'POST', route: '/v1/chat', secret: 'secret' },
    fields: { duration_ms: 0, status_code: 200, count: 1e12, category: 'upstream_timeout',
      outcome: 'failure', operation: 'completion', secret: 'secret', nested: { secret: 'secret' } } }));
  expect(f.records).toEqual([{ source: 'backend', level: 'INFO', event: 'http_finished',
    context: { method: 'POST', route: '/v1/chat', correlation_id: 'a'.repeat(32) },
    fields: { duration_ms: 0, count: 1e12, status_code: 200, operation: 'completion', outcome: 'failure', category: 'upstream_timeout' } }]);
  expect(JSON.stringify(f.records)).not.toContain('secret'); f.dispose();
});
it('rejects unknown events and levels and drops invalid scalar metadata without coercion', () => {
  const f = fixture();
  for (const event of ['external_log', 'secret-event', '', null]) f.stream.emit('data', line({ event }));
  for (const level of ['OFF', 'debug', 'secret-level', null]) f.stream.emit('data', line({ level }));
  expect(f.records).toEqual([]);
  f.stream.emit('data', line({ context: { correlation_id: 'A'.repeat(32), route: '/private-user-path' },
    fields: { count: true, duration_ms: -1, status_code: 1e13, category: 'secret', method: 'secret', operation: 'secret' } }));
  expect(f.records).toEqual([{ source: 'backend', level: 'INFO', event: 'http_finished', context: {}, fields: {} }]);
  f.dispose();
});
it('accepts the complete gate event allowlist including DEBUG independently of desktop silent', () => {
  const stream = new PassThrough(), output = new PassThrough(), lines: string[] = [], publish = vi.fn();
  vi.spyOn(output, 'write').mockImplementation(value => { lines.push(String(value)); return true; });
  const diagnostics = createDesktopDiagnostics({ WISP_DESKTOP_LOG_LEVEL: 'silent' }, { output, publish });
  const dispose = attachBackendDiagnostics(stream, diagnostics.backend);
  const events = ['application_starting', 'application_started', 'application_stopped', 'application_failed',
    'maintenance_started', 'maintenance_finished', 'ledger_maintenance_failed', 'lore_catalogue_unavailable',
    'http_started', 'http_finished', 'http_failed', 'completion_rejected', 'provider_started', 'provider_finished',
    'completion_background_finished', 'completion_background_failed'];
  for (const event of events) stream.emit('data', line({ event, level: 'DEBUG' }));
  expect(lines.map(value => JSON.parse(value).event)).toEqual(events);
  expect(lines.every(value => JSON.parse(value).source === 'backend')).toBe(true);
  expect(diagnostics.logger.getBufferedEntries()).toEqual([]); expect(publish).not.toHaveBeenCalled();
  dispose(); diagnostics.dispose();
});
it('handles chunk boundaries, invalid UTF-8 and JSON, bounded overflow drain and partial EOF', () => {
  const f = fixture(), valid = line();
  f.stream.emit('data', valid.subarray(0, 10)); expect(f.records).toEqual([]);
  f.stream.emit('data', valid.subarray(10)); expect(f.records).toHaveLength(1);
  f.stream.emit('data', Buffer.from([0xc3, 0x28, 10])); f.stream.emit('data', Buffer.from('invalid-json\n'));
  f.stream.emit('data', Buffer.alloc(200_000, 120)); f.stream.emit('data', valid);
  expect(f.records).toHaveLength(1);
  f.stream.emit('data', valid); expect(f.records).toHaveLength(2);
  f.stream.emit('data', valid.subarray(0, -1)); f.stream.emit('end');
  expect(f.records).toHaveLength(2); expect(f.stream.listenerCount('data')).toBe(0);
  expect(f.stream.listenerCount('end')).toBe(0); expect(f.stream.listenerCount('error')).toBe(0);
  f.stream.emit('data', valid); expect(f.records).toHaveLength(2); f.dispose();
});
it('caps accepted lines at twenty per fixed monotonic second without queue or catch-up', () => {
  const f = fixture();
  f.stream.emit('data', Buffer.concat(Array.from({ length: 25 }, () => line())));
  expect(f.records).toHaveLength(20); f.at(999); f.stream.emit('data', line()); expect(f.records).toHaveLength(20);
  f.at(1000); f.stream.emit('data', line()); expect(f.records).toHaveLength(21);
  f.at(20_000); expect(f.records).toHaveLength(21); f.stream.emit('data', line()); expect(f.records).toHaveLength(22);
  f.dispose();
});
it('accepts exactly 4096 bytes including newline and drops a longer line before resynchronizing', () => {
  const f = fixture(), valid = line(), body = valid.subarray(0, -1);
  f.stream.emit('data', Buffer.concat([body, Buffer.alloc(4095 - body.byteLength, 32), Buffer.from('\n')]));
  expect(f.records).toHaveLength(1);
  f.stream.emit('data', Buffer.concat([body, Buffer.alloc(4096 - body.byteLength, 32), Buffer.from('\n')]));
  expect(f.records).toHaveLength(1);
  f.stream.emit('data', valid); expect(f.records).toHaveLength(2); f.dispose();
});
it('retires its listeners and ignores late chunks even when the sink or stream fails', () => {
  const stream = new PassThrough(), sink = vi.fn(() => { throw new Error('synthetic output secret'); });
  const dispose = attachBackendDiagnostics(stream, sink);
  expect(() => stream.emit('data', line())).not.toThrow(); expect(sink).toHaveBeenCalledOnce();
  expect(() => stream.emit('error', new Error('synthetic stream secret'))).not.toThrow();
  stream.emit('data', line()); expect(sink).toHaveBeenCalledOnce(); dispose();
});
