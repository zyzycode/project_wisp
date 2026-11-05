import type { InitiativeControlResultDTO, InitiativeControlStatusDTO } from '../application/ports/initiative-controls.interface';
import type { WindowHelpStatusDTO } from '../application/ports/window-help.interface';
import { enumValue, exactRecord, plainText } from './dialogue-ipc-validation';
function number(value: unknown, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) throw new TypeError('Invalid initiative number');
  return value;
}
function integer(value: unknown): number { const result = number(value); if (!Number.isSafeInteger(result)) throw new TypeError('Invalid initiative integer'); return result; }
export function parseInitiativeStatus(value: unknown): InitiativeControlStatusDTO {
  const r = exactRecord(value, ['profileGeneration', 'enabled', 'capability', 'phase', 'blockReason', 'requestsSent', 'lastFailure']);
  if (typeof r.enabled !== 'boolean') throw new TypeError('Invalid initiative consent');
  return { profileGeneration: integer(r.profileGeneration), enabled: r.enabled,
    capability: enumValue(r.capability, ['ready', 'unavailable']), phase: enumValue(r.phase, ['off', 'waiting', 'generating', 'visible']),
    blockReason: enumValue(r.blockReason, ['none', 'provider_unavailable', 'memory_unavailable', 'quiet', 'away', 'sleeping', 'busy', 'disabled']),
    requestsSent: integer(r.requestsSent), lastFailure: enumValue(r.lastFailure, ['none', 'unavailable', 'auth', 'timeout', 'invalid_response']) };
}
export function parseInitiativeResult(value: unknown): InitiativeControlResultDTO {
  const r = exactRecord(value, ['ok'], ['status', 'code']);
  if (r.ok === true) { exactRecord(r, ['ok', 'status']); return { ok: true, status: parseInitiativeStatus(r.status) }; }
  exactRecord(r, ['ok', 'code']); if (r.ok !== false) throw new TypeError('Invalid initiative result');
  return { ok: false, code: enumValue(r.code, ['invalid_input', 'stale', 'unavailable']) };
}
export function parseWindowHelpStatus(value: unknown): WindowHelpStatusDTO {
  const r = exactRecord(value, ['phase'], ['requestId', 'target', 'expiresAtMs', 'outcome']);
  if (r.phase === 'none') { exactRecord(r, ['phase']); return { phase: 'none' }; }
  const requestId = plainText(r.requestId, 512, true);
  if (r.phase === 'closed') { exactRecord(r, ['phase', 'requestId', 'outcome']); return { phase: 'closed', requestId,
    outcome: enumValue(r.outcome, ['fulfilled', 'declined', 'unanswered', 'cancelled', 'target_lost']) }; }
  exactRecord(r, ['phase', 'requestId', 'target', 'expiresAtMs']);
  const t = exactRecord(r.target, ['region', 'left', 'top', 'width', 'height']);
  const left = number(t.left, 1), top = number(t.top, 1), width = number(t.width, 1), height = number(t.height, 1);
  if (width <= 0 || height <= 0 || left + width > 1.000000001 || top + height > 1.000000001) throw new TypeError('Invalid help rectangle');
  return { phase: enumValue(r.phase, ['preparing', 'waiting', 'assisting']), requestId, expiresAtMs: number(r.expiresAtMs),
    target: { region: enumValue(t.region, ['upper_left', 'upper_center', 'upper_right', 'middle_left', 'middle_center', 'middle_right', 'lower_left', 'lower_center', 'lower_right']), left, top, width, height } };
}
export function parseWindowHelpResult(value: unknown): { readonly ok: true } | { readonly ok: false; readonly code: 'invalid_input' | 'stale' } {
  const r = exactRecord(value, ['ok'], ['code']);
  if (r.ok === true) { exactRecord(r, ['ok']); return { ok: true }; }
  exactRecord(r, ['ok', 'code']); if (r.ok !== false) throw new TypeError('Invalid help result');
  return { ok: false, code: enumValue(r.code, ['invalid_input', 'stale']) };
}
