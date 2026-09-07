import type { DialogueCommandDTO, DialogueCommandReceiptDTO, DialoguePresentationDTO, DialogueFallbackReasonDTO } from './ipc-contracts';

export function exactRecord(value: unknown, keys: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid dialogue payload');
  const proto = Object.getPrototypeOf(value);
  if (proto !== null && proto !== Object.prototype) throw new TypeError('Invalid dialogue payload');
  const record = value as Record<string, unknown>;
  for (const key of Reflect.ownKeys(record)) {
    if (typeof key !== 'string' || ![...keys, ...optional].includes(key)
        || !('value' in Object.getOwnPropertyDescriptor(record, key)!)) throw new TypeError('Invalid dialogue payload');
  }
  if (keys.some(key => !Object.hasOwn(record, key))) throw new TypeError('Invalid dialogue payload');
  return record;
}
export function plainText(value: unknown, max: number, trim = false): string {
  if (typeof value !== 'string') throw new TypeError('Invalid dialogue text');
  const text = trim ? value.trim() : value;
  if (!text.trim() || text.length > max || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(text)) throw new TypeError('Invalid dialogue text');
  return text;
}
function id(value: unknown): string { const text = plainText(value, 128); if (text !== text.trim()) throw new TypeError('Invalid id'); return text; }
export function enumValue<const T extends string>(value: unknown, values: readonly T[]): T {
  if (typeof value !== 'string' || !values.includes(value as T)) throw new TypeError('Invalid dialogue enum'); return value as T;
}
export function parseDialogueCommand(value: unknown): DialogueCommandDTO {
  const base = exactRecord(value, ['type', 'streamId', 'conversationId', 'sequence'], ['text']);
  const type = enumValue(base.type, ['send', 'reset']);
  exactRecord(value, ['type', 'streamId', 'conversationId', 'sequence', ...(type === 'send' ? ['text'] : [])]);
  if (!Number.isSafeInteger(base.sequence) || typeof base.sequence !== 'number' || base.sequence <= 0) throw new TypeError('Invalid sequence');
  const meta = { streamId: id(base.streamId), conversationId: id(base.conversationId), sequence: base.sequence };
  return type === 'send' ? { ...meta, type, text: plainText(base.text, 240, true) } : { ...meta, type };
}
export function parseDialogueReceipt(value: unknown): DialogueCommandReceiptDTO {
  const r = exactRecord(value, ['status'], ['conversationId', 'reason']);
  if (r.status === 'accepted') { exactRecord(r, ['status', 'conversationId']); return { status: 'accepted', conversationId: id(r.conversationId) }; }
  exactRecord(r, ['status', 'reason']); enumValue(r.status, ['rejected']);
  return { status: 'rejected', reason: enumValue(r.reason, ['busy', 'stale', 'invalid_input', 'unavailable']) };
}
export function parseDialoguePresentation(value: unknown): DialoguePresentationDTO {
  const r = exactRecord(value, ['conversationId', 'canSubmit', 'turn']);
  if (typeof r.canSubmit !== 'boolean') throw new TypeError('Invalid canSubmit');
  const meta = { conversationId: id(r.conversationId), canSubmit: r.canSubmit };
  const t = exactRecord(r.turn, ['phase'], ['requestId', 'replyText', 'outcome', 'message']);
  switch (t.phase) {
    case 'idle': exactRecord(t, ['phase']); return { ...meta, turn: { phase: 'idle' } };
    case 'thinking': exactRecord(t, ['phase', 'requestId']);
      if (r.canSubmit) throw new TypeError('Thinking cannot submit');
      return { ...meta, turn: { phase: 'thinking', requestId: id(t.requestId) } };
    case 'error': exactRecord(t, ['phase', 'requestId', 'message']);
      return { ...meta, turn: { phase: 'error', requestId: id(t.requestId), message: plainText(t.message, 2000) } };
    case 'completed': {
      exactRecord(t, ['phase', 'requestId', 'replyText', 'outcome']);
      const o = exactRecord(t.outcome, ['kind'], ['reason']);
      const kind = enumValue(o.kind, ['success', 'fallback']);
      exactRecord(o, kind === 'success' ? ['kind'] : ['kind', 'reason']);
      const outcome = kind === 'success' ? { kind } : { kind, reason: enumValue<DialogueFallbackReasonDTO>(o.reason, ['degraded', 'offline', 'timeout', 'provider_error', 'invalid_response']) };
      return { ...meta, turn: { phase: 'completed', requestId: id(t.requestId), replyText: plainText(t.replyText, 2000), outcome } };
    }
    default: throw new TypeError('Invalid turn');
  }
}
