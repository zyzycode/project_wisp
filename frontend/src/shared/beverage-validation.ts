import type { BeveragePreferenceCommandDTO, BeveragePreferenceDTO, BeveragePreferenceRefDTO, InterestThreadResultDTO } from './ipc-contracts';
import { enumValue, exactRecord, plainText } from './validation-primitives';
import { memoryCardInteger, parseMemoryCardSource } from './memory-card-validation';
export function beverageId(value: unknown): string { const text = plainText(value, 128); if (text !== text.trim()) throw new TypeError('Invalid preference id'); return text; }
export function parseBeverageRef(value: unknown): BeveragePreferenceRefDTO { const r = exactRecord(value, ['itemId', 'revision']); return { itemId: beverageId(r.itemId), revision: memoryCardInteger(r.revision, 1) }; }
export function parseBeverageQuote(value: unknown): string { const text = plainText(value, 240); if (text !== text.trim() || /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\uD800-\uDFFF]/u.test(text)) throw new TypeError('Invalid preference quote'); return text; }
export function parseBeverageProposal(value: unknown, userText?: string) {
  const r = exactRecord(value, ['value', 'evidenceQuote']); const evidenceQuote = parseBeverageQuote(r.evidenceQuote);
  if (userText !== undefined && evidenceQuote !== userText.trim()) throw new TypeError('Mismatched preference source');
  return { value: enumValue(r.value, ['coffee', 'tea']), evidenceQuote };
}
export function parseBeverageRead(value: unknown) { const r = exactRecord(value, ['streamId']); return { streamId: beverageId(r.streamId) }; }
export function parseBeverageCommand(value: unknown): BeveragePreferenceCommandDTO {
  const r = exactRecord(value, ['streamId', 'sequence', 'generation', 'commandId', 'kind', 'expected'], ['itemId', 'offerId', 'consented', 'value', 'confirmed']);
  const base = { streamId: beverageId(r.streamId), sequence: memoryCardInteger(r.sequence, 1), generation: memoryCardInteger(r.generation), commandId: beverageId(r.commandId) };
  if (r.kind === 'save_hypothesis') {
    exactRecord(value, ['streamId', 'sequence', 'generation', 'commandId', 'kind', 'expected', 'itemId', 'offerId', 'consented']);
    if (r.expected !== null || r.consented !== true) throw new TypeError('Explicit preference consent required');
    return { ...base, kind: 'save_hypothesis', expected: null, itemId: beverageId(r.itemId), offerId: beverageId(r.offerId), consented: true };
  }
  const expected = parseBeverageRef(r.expected);
  if (r.kind === 'confirm' || r.kind === 'correct') {
    exactRecord(value, ['streamId', 'sequence', 'generation', 'commandId', 'kind', 'expected', 'value', 'confirmed']);
    if (r.confirmed !== true) throw new TypeError('Explicit statement required');
    return { ...base, kind: r.kind, expected, value: enumValue(r.value, ['coffee', 'tea']), confirmed: true };
  }
  exactRecord(value, ['streamId', 'sequence', 'generation', 'commandId', 'kind', 'expected']);
  return { ...base, expected, kind: enumValue(r.kind, ['reject', 'withdraw', 'delete']) };
}
export function parseBeveragePreference(value: unknown): BeveragePreferenceDTO {
  const r = exactRecord(value, ['ref', 'source', 'evidenceQuote', 'value', 'provenance', 'validity', 'manuallyCorrected', 'status']);
  if (typeof r.manuallyCorrected !== 'boolean') throw new TypeError('Invalid correction state');
  return { ref: parseBeverageRef(r.ref), source: parseMemoryCardSource(r.source), evidenceQuote: parseBeverageQuote(r.evidenceQuote), value: enumValue(r.value, ['coffee', 'tea']), provenance: enumValue(r.provenance, ['model_proposal', 'user_statement']), validity: enumValue(r.validity, ['hypothesis', 'confirmed', 'rejected']), status: enumValue(r.status, ['active', 'withdrawn']), manuallyCorrected: r.manuallyCorrected };
}
function result<T>(value: unknown, parse: (value: unknown) => T): InterestThreadResultDTO<T> {
  const r = exactRecord(value, ['ok', 'generation'], ['code', 'value']); const generation = memoryCardInteger(r.generation);
  if (r.ok === false) { exactRecord(r, ['ok', 'generation', 'code']); return { ok: false, generation, code: enumValue(r.code, ['unavailable', 'busy', 'storage_full', 'corrupt', 'unsupported_version', 'invalid_data', 'conflict', 'stale', 'io_error']) }; }
  exactRecord(r, ['ok', 'generation', 'value']); if (r.ok !== true) throw new TypeError('Invalid preference result'); return { ok: true, generation, value: parse(r.value) };
}
export const parseBeverageReadResult = (value: unknown) => result(value, v => v === null ? null : parseBeveragePreference(v));
export const parseBeverageMutationResult = (value: unknown) => result(value, v => { const r = exactRecord(v, ['commandId', 'ref', 'outcome']); return { commandId: beverageId(r.commandId), ref: parseBeverageRef(r.ref), outcome: enumValue(r.outcome, ['hypothesis', 'confirmed', 'rejected', 'withdrawn', 'deleted']) }; });
