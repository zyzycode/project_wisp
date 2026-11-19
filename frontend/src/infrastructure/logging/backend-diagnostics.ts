import type { Readable } from 'node:stream';
import { performance } from 'node:perf_hooks';
import type { DiagnosticRecord } from './diagnostic-output';

const EVENTS = new Set(['application_starting', 'application_started', 'application_stopped', 'application_failed',
  'maintenance_started', 'maintenance_finished', 'ledger_maintenance_failed', 'lore_catalogue_unavailable',
  'http_started', 'http_finished', 'http_failed', 'completion_rejected', 'provider_started', 'provider_finished',
  'completion_background_finished', 'completion_background_failed']);
const LEVELS = new Set(['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL']);
const LABELS: Readonly<Record<string, readonly string[]>> = {
  operation: ['maintenance', 'http', 'completion', 'provider', 'settlement', 'cancel'],
  outcome: ['success', 'failure', 'cancelled', 'expected', 'unexpected', 'no_response'],
  method: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS', 'OTHER'],
  route: ['/health', '/v1/chat', '/v1/touch', '/v1/events', '/v1/observation', '/v1/summary',
    '/v1/screen-observation', '/v1/screen-observation/capability', 'other'],
  category: ['invalid_request', 'payload_too_large', 'request_conflict', 'request_in_progress', 'rate_limited',
    'budget_exhausted', 'upstream_unavailable', 'upstream_timeout', 'invalid_model_response', 'unexpected'],
};
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function safeFields(value: unknown): Record<string, string | number> {
  const result: Record<string, string | number> = {};
  if (!record(value)) return result;
  for (const key of ['duration_ms', 'count', 'status_code']) {
    const number = value[key];
    if (typeof number === 'number' && Number.isFinite(number) && number >= 0 && number <= 1e12) result[key] = number;
  }
  for (const [key, allowed] of Object.entries(LABELS)) {
    const label = value[key];
    if (typeof label === 'string' && allowed.includes(label)) result[key] = label;
  }
  return result;
}
function project(bytes: Buffer): DiagnosticRecord | null {
  try {
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!record(value) || typeof value.event !== 'string' || !EVENTS.has(value.event)
      || typeof value.level !== 'string' || !LEVELS.has(value.level)) return null;
    const context: Record<string, string | number> = safeFields(value.context);
    const correlation = record(value.context) ? value.context.correlation_id : undefined;
    if (typeof correlation === 'string' && /^[a-f0-9]{32}$/u.test(correlation)) context.correlation_id = correlation;
    return { source: 'backend', level: value.level, event: value.event, context, fields: safeFields(value.fields) };
  } catch { return null; }
}

/** Bounded framing over the existing child's stderr. Never retains or forwards raw content. */
export function attachBackendDiagnostics(stream: Readable, emit: (value: DiagnosticRecord) => void,
  now: () => number = () => performance.now()): () => void {
  let bytes: Buffer = Buffer.alloc(0), overflow = false, retired = false;
  let windowStart = now(), lines = 0;
  const complete = () => {
    const at = now();
    if (at - windowStart >= 1000) { windowStart = at; lines = 0; }
    if (++lines > 20 || overflow) return;
    const value = project(bytes);
    if (value) { try { emit(value); } catch { /* Diagnostics cannot affect the child lifecycle. */ } }
  };
  const data = (chunk: unknown) => {
    if (retired || !Buffer.isBuffer(chunk)) return;
    let start = 0;
    while (start < chunk.byteLength) {
      const end = chunk.indexOf(10, start), limit = end === -1 ? chunk.byteLength : end;
      if (!overflow) {
        if (bytes.byteLength + limit - start >= 4096) { overflow = true; bytes = Buffer.alloc(0); }
        else bytes = Buffer.concat([bytes, chunk.subarray(start, limit)]);
      }
      if (end === -1) break;
      complete(); bytes = Buffer.alloc(0); overflow = false; start = end + 1;
    }
  };
  const dispose = () => {
    retired = true; bytes = Buffer.alloc(0); overflow = false;
    stream.removeListener('data', data); stream.removeListener('end', dispose); stream.removeListener('error', dispose);
  };
  stream.on('data', data); stream.on('end', dispose); stream.on('error', dispose);
  return dispose;
}
