import { expect, it } from 'vitest';
import { parseSummaryPreview, parseSummaryPreviewCommand, parseSummaryConfirm, parseSummaryDeleteResult, parseSummaryPreviewResult, parseSummaryTextResult } from '../../src/shared/summary-ipc-validation';
const preview = { ok: true, value: { previewId: 'p', expiresAt: 120000, pairs: Array.from({ length: 4 }, () => ({ userText: 'Вопрос', assistantText: 'Ответ' })) } };
it('admits only exact preview text pairs and public summary statuses', () => {
  expect(parseSummaryPreviewResult(preview)).toEqual(preview);
  for (const value of [ { ...preview, secret: true }, { ...preview, value: { ...preview.value, pairs: preview.value.pairs.slice(1) } }, { ok: false, code: '/private/path' }, { ...preview, value: { ...preview.value, pairs: preview.value.pairs.map(pair => ({ ...pair, sessionId: 'private' })) } } ]) expect(() => parseSummaryPreviewResult(value)).toThrow();
  expect(() => parseSummaryTextResult({ ok: true, value: 'x'.repeat(1201) })).toThrow();
  expect(() => parseSummaryTextResult({ ok: true, value: 'bad\u0000' })).toThrow();
  expect(() => parseSummaryDeleteResult({ ok: true, value: 'secret' })).toThrow();
});
it('requires stream binding and stable confirm identity without arbitrary payload', () => {
  expect(parseSummaryConfirm({ streamId: 's', commandId: 'c', previewId: 'p' })).toEqual({ streamId: 's', commandId: 'c', previewId: 'p' });
  expect(() => parseSummaryConfirm({ streamId: 's', commandId: 'c', previewId: 'p', pairs: [] })).toThrow();
});

it('validates explicit UTC life preview commands and semantic-only event previews', () => {
  const command = { streamId: 'stream', mode: 'life_events', fromDateUTC: '2026-10-23', throughDateUTC: '2026-11-05' };
  expect(parseSummaryPreviewCommand(command)).toEqual(command);
  for (const value of [{ ...command, fromDateUTC: '2026-10-22' }, { ...command, fromDateUTC: '2026-02-30' }, { ...command, sources: [] }, { ...command, mode: null }, { streamId: 'stream', fromDateUTC: '2026-11-01' }]) expect(() => parseSummaryPreviewCommand(value)).toThrow();
  const value = { mode: 'life_events', previewId: 'preview', expiresAt: 120000, fromDateUTC: command.fromDateUTC, throughDateUTC: command.throughDateUTC, events: Array.from({ length: 4 }, () => ({ activity: 'cursor_game', outcome: 'completed', cause: 'completed', actor: 'autonomy', participation: 'user_engaged', executedMs: 1000, occurredAt: '2026-11-05T12:00:00.000Z' })) };
  expect(parseSummaryPreview(value)).toEqual(value);
  expect(() => parseSummaryPreview({ ...value, events: value.events.map(e => ({ ...e, appRunId: 'private' })) })).toThrow();
  expect(() => parseSummaryPreview({ ...value, pairs: [] })).toThrow();
});
