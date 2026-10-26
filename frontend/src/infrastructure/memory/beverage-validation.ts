import type {
  BeverageMutation, BeveragePreference, BeveragePreferenceRef, BeverageReceipt,
  BeverageTurnUse, BeverageCorrectionTurn,
} from '../../application/ports/memory-beverage.interface';
import { record, text, integer, timestamp, MemoryDataError } from './validation';

export function beverageRef(value: unknown): BeveragePreferenceRef {
  const input = record(value, ['itemId', 'revision']);
  return { itemId: text(input.itemId), revision: integer(input.revision, 1) };
}
export function beverageValue(value: unknown): 'coffee' | 'tea' {
  if (value !== 'coffee' && value !== 'tea') throw new MemoryDataError('invalid_data');
  return value;
}
function source(value: unknown) {
  const input = record(value, ['userMessageId', 'assistantMessageId']);
  const result = { userMessageId: text(input.userMessageId), assistantMessageId: text(input.assistantMessageId) };
  if (result.userMessageId === result.assistantMessageId) throw new MemoryDataError('invalid_data');
  return result;
}
export function beverageMutation(value: unknown): BeverageMutation {
  const input = record(value);
  const common = { commandId: text(input.commandId), updatedAt: timestamp(input.updatedAt) };
  if (input.kind === 'save_hypothesis') {
    record(input, ['kind', 'commandId', 'updatedAt', 'itemId', 'expected', 'value', 'source', 'consented']);
    if (input.expected !== null || input.consented !== true) throw new MemoryDataError('invalid_data');
    return { ...common, kind: input.kind, itemId: text(input.itemId), expected: null,
      value: beverageValue(input.value), source: source(input.source), consented: true };
  }
  if (input.kind === 'confirm' || input.kind === 'correct') {
    record(input, ['kind', 'commandId', 'updatedAt', 'expected', 'value', 'source', 'confirmed']);
    if (input.confirmed !== true) throw new MemoryDataError('invalid_data');
    return { ...common, kind: input.kind, expected: beverageRef(input.expected),
      value: beverageValue(input.value), source: source(input.source), confirmed: true };
  }
  if (input.kind !== 'reject' && input.kind !== 'withdraw' && input.kind !== 'delete') throw new MemoryDataError('invalid_data');
  record(input, ['kind', 'commandId', 'updatedAt', 'expected']);
  return { ...common, kind: input.kind, expected: beverageRef(input.expected) };
}
export function beverageRead(value: unknown): BeveragePreference | null {
  if (value === null) return null;
  const input = record(value, ['ref', 'category', 'value', 'provenance', 'validity', 'manuallyCorrected', 'status', 'source', 'updatedAt', 'evidenceQuote']);
  if (input.category !== 'beverage_preference'
    || (input.provenance !== 'model_proposal' && input.provenance !== 'user_statement')
    || (input.validity !== 'hypothesis' && input.validity !== 'confirmed' && input.validity !== 'rejected')
    || typeof input.manuallyCorrected !== 'boolean'
    || (input.status !== 'active' && input.status !== 'withdrawn')) throw new MemoryDataError('invalid_data');
  return { ref: beverageRef(input.ref), category: input.category, value: beverageValue(input.value),
    provenance: input.provenance, validity: input.validity, manuallyCorrected: input.manuallyCorrected,
    status: input.status, source: source(input.source), updatedAt: timestamp(input.updatedAt),
    evidenceQuote: text(input.evidenceQuote, 240) };
}
export function beverageReceipt(value: unknown): BeverageReceipt {
  const input = record(value, ['commandId', 'ref', 'outcome']);
  if (input.outcome !== 'hypothesis' && input.outcome !== 'confirmed' && input.outcome !== 'rejected'
    && input.outcome !== 'withdrawn' && input.outcome !== 'deleted') throw new MemoryDataError('invalid_data');
  return { commandId: text(input.commandId), ref: beverageRef(input.ref), outcome: input.outcome };
}
export function beverageUse(value: unknown): BeverageTurnUse {
  const input = record(value, ['expected', 'requestId', 'userMessageId']);
  return { expected: beverageRef(input.expected), requestId: text(input.requestId), userMessageId: text(input.userMessageId) };
}
export function beverageCorrection(value: unknown): BeverageCorrectionTurn {
  const input = record(value, ['expected', 'value', 'requestId', 'userMessageId']);
  return { ...beverageUse({ expected: input.expected, requestId: input.requestId, userMessageId: input.userMessageId }),
    value: beverageValue(input.value) };
}
