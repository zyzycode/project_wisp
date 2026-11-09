import type { ScreenObservationEvidence } from '../application/ports/backend-screen-observation-contract';
import type { ScreenObservationRegion } from '../application/ports/screen-observation.interface';
import type { ScreenObservationCommand, ScreenObservationError, ScreenObservationState } from './screen-observation-contracts';

export function screenRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw new TypeError('Invalid screen observation');
  return value as Record<string, unknown>;
}
function id(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128 || /[\u0000-\u001f\u007f]/u.test(value)) throw new TypeError('Invalid screen identity');
  return value;
}
export function parseScreenRegion(value: unknown): ScreenObservationRegion {
  const r = screenRecord(value, ['left', 'top', 'width', 'height']);
  const { left, top, width, height } = r;
  if (typeof left !== 'number' || typeof top !== 'number' || typeof width !== 'number' || typeof height !== 'number'
    || ![left, top, width, height].every(Number.isFinite) || left < 0 || top < 0 || width <= 0 || height <= 0 || left + width > 1 || top + height > 1) throw new TypeError('Invalid screen region');
  return { left, top, width, height };
}
export function parseScreenCommand(value: unknown): ScreenObservationCommand {
  if (!value || typeof value !== 'object' || !('type' in value)) throw new TypeError('Invalid screen command');
  const r = screenRecord(value, value.type === 'region' ? ['type', 'streamId', 'conversationId', 'region'] : ['type', 'streamId', 'conversationId']);
  const identity = { streamId: id(r.streamId), conversationId: id(r.conversationId) };
  if (r.type === 'region') return { ...identity, type: 'region', region: parseScreenRegion(r.region) };
  if (r.type !== 'start' && r.type !== 'read' && r.type !== 'cancel' && r.type !== 'send') throw new TypeError('Invalid screen command');
  return { ...identity, type: r.type };
}
export function parseScreenEvidence(value: unknown): ScreenObservationEvidence {
  const r = screenRecord(value, ['visible', 'possible', 'unknown']);
  function list(value: unknown, cap: number): readonly string[] {
    if (!Array.isArray(value) || value.length > cap) throw new TypeError('Invalid evidence');
    return value.map((text: unknown) => {
      if (typeof text !== 'string' || text.length < 1 || text.length > 160 || text.trim() !== text || /[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/u.test(text.replace(/[\ud800-\udbff][\udc00-\udfff]/gu, ''))) throw new TypeError('Invalid evidence text');
      return text;
    });
  }
  const result = { visible: list(r.visible, 3), possible: list(r.possible, 2), unknown: list(r.unknown, 2) };
  const all = [...result.visible, ...result.possible, ...result.unknown];
  if (!all.length || all.reduce((sum, text) => sum + text.length, 0) > 800) throw new TypeError('Invalid evidence size');
  return result;
}
const phases = ['idle', 'selecting', 'capture_confirmation', 'preparing', 'preview', 'send_confirmation', 'generating', 'visible'] as const;
const errors: readonly ScreenObservationError[] = ['unavailable', 'unsupported_platform', 'multiple_displays', 'busy', 'cancelled', 'timeout', 'stale', 'invalid_response'];
export function parseScreenState(value: unknown): ScreenObservationState {
  const r = screenRecord(value, ['phase', 'error', 'preview', 'evidence']);
  const phase = phases.find(phase => phase === r.phase), error = errors.find(error => error === r.error) ?? null;
  if (!phase || (r.error !== null && !error)) throw new TypeError('Invalid screen state');
  let preview: ScreenObservationState['preview'] = null;
  if (r.preview !== null) {
    const p = screenRecord(r.preview, ['previewId', 'dataBase64', 'width', 'height', 'expiresAtMs']);
    if (typeof p.dataBase64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(p.dataBase64) || p.dataBase64.length < 8 || p.dataBase64.length > 349528
      || typeof p.width !== 'number' || typeof p.height !== 'number' || !Number.isInteger(p.width) || !Number.isInteger(p.height) || p.width < 32 || p.height < 32 || p.width > 1024 || p.height > 1024 || typeof p.expiresAtMs !== 'number' || !Number.isFinite(p.expiresAtMs)) throw new TypeError('Invalid screen preview');
    preview = { previewId: id(p.previewId), dataBase64: p.dataBase64, width: p.width, height: p.height, expiresAtMs: p.expiresAtMs };
  }
  const evidence = r.evidence === null ? null : parseScreenEvidence(r.evidence);
  if ((phase === 'preview' || phase === 'send_confirmation') !== !!preview || (phase === 'visible') !== !!evidence) throw new TypeError('Invalid screen projection');
  return { phase, error, preview, evidence };
}
