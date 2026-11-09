import type { WindowFocusChooseCommandDTO, WindowFocusOpenCommandDTO, WindowFocusOutcome,
  WindowFocusReceiptDTO, WindowFocusSelectorDTO } from '../application/ports/external-window-focus.port';
import type { WindowFocusControlResult, WindowFocusStateDTO } from '../application/ports/window-focus-controls.interface';
import { enumValue, exactRecord, plainText } from './dialogue-ipc-validation';
export const focusId = (value: unknown): string => plainText(value, 128, true);
export function parseWindowFocusOpen(value: unknown): WindowFocusOpenCommandDTO {
  const r = exactRecord(value, ['streamId', 'conversationId', 'requestId']);
  return { streamId: focusId(r.streamId), conversationId: focusId(r.conversationId), requestId: focusId(r.requestId) };
}
export function parseWindowFocusChoose(value: unknown): WindowFocusChooseCommandDTO {
  const r = exactRecord(value, ['streamId', 'conversationId', 'requestId', 'selectorId', 'selectionId']);
  return { streamId: focusId(r.streamId), conversationId: focusId(r.conversationId), requestId: focusId(r.requestId),
    selectorId: focusId(r.selectorId), selectionId: focusId(r.selectionId) };
}
function finite(value: unknown, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) throw TypeError('Invalid focus number');
  return value;
}
export function parseWindowFocusSelector(value: unknown): WindowFocusSelectorDTO {
  const r = exactRecord(value, ['selectorId', 'expiresAtMs', 'candidates']);
  if (!Array.isArray(r.candidates) || r.candidates.length > 20) throw TypeError('Invalid focus choices');
  const ids = new Set<string>();
  const candidates = r.candidates.map(value => {
    const c = exactRecord(value, ['selectionId', 'left', 'top', 'width', 'height']);
    const selectionId = focusId(c.selectionId);
    if (ids.has(selectionId)) throw TypeError('Duplicate focus choice'); ids.add(selectionId);
    const left = finite(c.left, 1), top = finite(c.top, 1), width = finite(c.width, 1), height = finite(c.height, 1);
    if (width <= 0 || height <= 0 || left + width > 1.000000001 || top + height > 1.000000001) throw TypeError('Invalid focus rectangle');
    return { selectionId, left, top, width, height };
  });
  return { selectorId: focusId(r.selectorId), expiresAtMs: finite(r.expiresAtMs), candidates };
}
export function parseWindowFocusOutcome(value: unknown): WindowFocusOutcome {
  const r = exactRecord(value, ['status'], ['effect', 'reason']);
  if (r.status === 'unsupported') { exactRecord(r, ['status']); return { status: 'unsupported' }; }
  if (r.status === 'success') { exactRecord(r, ['status', 'effect']); return { status: 'success', effect: enumValue(r.effect, ['already_foreground', 'focus_observed']) }; }
  exactRecord(r, ['status', 'reason']);
  if (r.status === 'rejected') return { status: 'rejected', reason: enumValue(r.reason, ['invalid_request', 'stale_request', 'expired', 'declined', 'duplicate', 'target_lost', 'target_changed', 'unavailable', 'session_inactive', 'cancelled_before_dispatch', 'os_denied']) };
  if (r.status === 'unknown') return { status: 'unknown', reason: enumValue(r.reason, ['timeout_after_dispatch', 'cancelled_after_dispatch', 'target_changed_after_dispatch', 'verification_unavailable', 'bridge_lost']) };
  throw TypeError('Invalid focus outcome');
}
export function parseWindowFocusReceipt(value: unknown): WindowFocusReceiptDTO {
  const r = exactRecord(value, ['attemptId', 'status'], ['effect', 'reason']);
  const { attemptId, ...outcome } = r;
  return { ...parseWindowFocusOutcome(outcome), attemptId: focusId(attemptId) };
}
export function parseWindowFocusState(value: unknown): WindowFocusStateDTO {
  const r = exactRecord(value, ['capability', 'selector', 'pending', 'receipt']);
  if (typeof r.pending !== 'boolean') throw TypeError('Invalid focus pending');
  return { capability: enumValue(r.capability, ['available', 'unavailable', 'unsupported']), pending: r.pending,
    selector: r.selector === null ? null : parseWindowFocusSelector(r.selector),
    receipt: r.receipt === null ? null : parseWindowFocusReceipt(r.receipt) };
}
export function parseWindowFocusResult(value: unknown): WindowFocusControlResult {
  const r = exactRecord(value, ['ok'], ['state', 'code']);
  if (r.ok === true) { exactRecord(r, ['ok', 'state']); return { ok: true, state: parseWindowFocusState(r.state) }; }
  exactRecord(r, ['ok', 'code']); if (r.ok !== false) throw TypeError('Invalid focus result');
  return { ok: false, code: enumValue(r.code, ['invalid_input', 'stale', 'busy']) };
}
