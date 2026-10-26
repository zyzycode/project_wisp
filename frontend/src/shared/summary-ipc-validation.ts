import { summaryPlainText } from './summary-text-validation';
import type { SummaryCommandDTO, SummaryConfirmCommandDTO, SummaryPreviewDTO, SummaryResultDTO } from './ipc-contracts';
import { enumValue, exactRecord } from './validation-primitives';
function id(value: unknown): string { const result = summaryPlainText(value, 128); if (result.trim() !== result) throw new TypeError('Invalid summary id'); return result; }
export function parseSummaryCommand(input: unknown): SummaryCommandDTO {
  const value = exactRecord(input, ['streamId']); return { streamId: id(value.streamId) };
}
export function parseSummaryConfirm(input: unknown): SummaryConfirmCommandDTO {
  const value = exactRecord(input, ['streamId', 'commandId', 'previewId']);
  return { streamId: id(value.streamId), commandId: id(value.commandId), previewId: id(value.previewId) };
}
export function parseSummaryPreview(input: unknown): SummaryPreviewDTO {
  const value = exactRecord(input, ['previewId', 'expiresAt', 'pairs']);
  if (!Number.isSafeInteger(value.expiresAt) || typeof value.expiresAt !== 'number' || value.expiresAt < 0 || !Array.isArray(value.pairs) || value.pairs.length < 4 || value.pairs.length > 8) throw new TypeError('Invalid summary preview');
  const pairs = value.pairs.map(input => { const pair = exactRecord(input, ['userText', 'assistantText']); return { userText: summaryPlainText(pair.userText, 240), assistantText: summaryPlainText(pair.assistantText, 2000) }; });
  if (pairs.reduce((sum, pair) => sum + pair.userText.length + pair.assistantText.length, 0) > 8000) throw new TypeError('Invalid summary preview size');
  return { previewId: id(value.previewId), expiresAt: value.expiresAt, pairs };
}
function result<T>(input: unknown, parse: (value: unknown) => T): SummaryResultDTO<T> {
  const value = exactRecord(input, ['ok'], ['value', 'code']);
  if (value.ok === false) { exactRecord(value, ['ok', 'code']); return { ok: false, code: enumValue(value.code, ['unavailable', 'busy', 'stale', 'rate_limited', 'failed', 'conflict']) }; }
  if (value.ok !== true) throw new TypeError('Invalid summary result');
  exactRecord(value, ['ok', 'value']); return { ok: true, value: parse(value.value) };
}
export const parseSummaryPreviewResult = (input: unknown): SummaryResultDTO<SummaryPreviewDTO> => result(input, parseSummaryPreview);
export const parseSummaryTextResult = (input: unknown): SummaryResultDTO<string> => result(input, value => summaryPlainText(value, 1200));
export const parseSummaryDeleteResult = (input: unknown): SummaryResultDTO<null> => result(input, value => { if (value !== null) throw new TypeError('Invalid summary deletion'); return null; });
