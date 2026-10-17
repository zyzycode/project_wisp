import { expect, it } from 'vitest';
import { parseSummaryConfirm, parseSummaryDeleteResult, parseSummaryPreviewResult, parseSummaryTextResult } from '../../src/shared/summary-ipc-validation';
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
