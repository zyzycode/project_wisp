import type { ExternalWindowSurface } from '../../domain/behavior/surface-kinematics';
import type { WindowFocusOutcome, WindowFocusPreparation } from '../../application/ports/external-window-focus.port';
import { exactRecord } from '../../shared/dialogue-ipc-validation';
import { parseWindowFocusOutcome } from '../../shared/window-focus-validation';
export interface FocusBridgeTarget {
  readonly token: string; readonly signature: string;
  readonly x: number; readonly y: number; readonly width: number; readonly height: number;
}
export type FocusBridgeCommand =
  | { readonly action: 'prepare'; readonly attempt: string; readonly target: FocusBridgeTarget }
  | { readonly action: 'commit'; readonly attempt: string; readonly nonce: string; readonly token: string };
export const focusSurfaceSignature = (s: ExternalWindowSurface): string => JSON.stringify([
  s.kind, s.bounds.x, s.bounds.y, s.bounds.width, s.bounds.height, s.supportY ?? null, s.side ?? null,
]);
export function serializeFocusCommand(command: FocusBridgeCommand, id: number): string {
  const opaque = (s: string): string => { if (!/^[a-f0-9]{32}$/u.test(s)) throw TypeError('Invalid private focus token'); return s; };
  if (command.action === 'commit') return `C ${id} ${opaque(command.attempt)} ${opaque(command.nonce)} ${opaque(command.token)}\n`;
  const t = command.target;
  if (![t.x, t.y, t.width, t.height].every(Number.isSafeInteger) || t.width <= 0 || t.height <= 0) throw TypeError('Invalid focus geometry');
  return `P ${id} ${opaque(command.attempt)} ${opaque(t.token)} ${t.x} ${t.y} ${t.width} ${t.height}\n`;
}
export function parseFocusBridgeResponse(value: unknown, id: number, action: FocusBridgeCommand['action']): Omit<Extract<WindowFocusPreparation, { status: 'prepared' }>, 'value'> & { readonly preparedId: string } | WindowFocusOutcome {
  const r = exactRecord(value, ['requestId', 'action', 'status'], ['preparedId', 'reason', 'effect']);
  if (r.requestId !== id || r.action !== action) throw TypeError('Invalid focus response');
  if (action === 'prepare' && r.status === 'prepared') {
    exactRecord(r, ['requestId', 'action', 'status', 'preparedId']);
    if (typeof r.preparedId !== 'string' || !/^[a-f0-9]{32}$/u.test(r.preparedId)) throw TypeError('Invalid focus nonce');
    return { status: 'prepared', preparedId: r.preparedId };
  }
  const { requestId: _requestId, action: _action, ...outcome } = r;
  const parsed = parseWindowFocusOutcome(outcome);
  if (action === 'prepare' && parsed.status !== 'rejected' && parsed.status !== 'unsupported') throw TypeError('Invalid preparation outcome');
  return parsed;
}
