import type { RoutineStatusDTO } from './ipc-contracts';
import { exactRecord } from './dialogue-ipc-validation';
export function parseRoutineStatus(input: unknown): RoutineStatusDTO {
  const r = exactRecord(input, ['source', 'storage', 'lastAcknowledgedAt']);
  if (r.source !== 'available' && r.source !== 'unknown' && r.source !== 'unsupported') throw new TypeError('Invalid routine source');
  if (r.storage !== 'initializing' && r.storage !== 'persistent' && r.storage !== 'degraded' && r.storage !== 'volatile') throw new TypeError('Invalid routine storage');
  if (r.lastAcknowledgedAt !== null && (typeof r.lastAcknowledgedAt !== 'string' || r.lastAcknowledgedAt.length > 32 || !Number.isFinite(Date.parse(r.lastAcknowledgedAt)) || new Date(r.lastAcknowledgedAt).toISOString() !== r.lastAcknowledgedAt)) throw new TypeError('Invalid routine date');
  return { source: r.source, storage: r.storage, lastAcknowledgedAt: r.lastAcknowledgedAt };
}
