import { expect, it } from 'vitest';
import { parseInterestThreadCommand, parseInterestThreadReadResult } from '../../src/shared/interest-thread-validation';
import { parseDialogueCommand, parseDialoguePresentation } from '../../src/shared/dialogue-ipc-validation';
const command = { kind: 'confirm', streamId: 's', sequence: 1, generation: 0, commandId: 'cmd', threadId: 't', expected: null, conversationId: 'c', source: { userMessageId: 'u', assistantMessageId: 'a' }, text: 'сегодня собеседование', confirmed: true };
it('accepts bounded exact quote, unicode scalars, newline/tab and explicit local refs', () => {
  for (const text of ['x'.repeat(160), '🙂'.repeat(80), 'line\nnext\tword']) expect(parseInterestThreadCommand({ ...command, text })).toMatchObject({ text });
  const replyToInterestThread = { threadId: 't', revision: 2 };
  expect(parseDialogueCommand({ type: 'send', text: 'его перенесли', streamId: 's', conversationId: 'c', sequence: 1, replyToInterestThread })).toMatchObject({ replyToInterestThread });
  expect(parseDialoguePresentation({ conversationId: 'c', canSubmit: true, turn: { phase: 'completed', requestId: 'r', replyText: 'Как дела?', outcome: { kind: 'success' }, interestThread: replyToInterestThread } }).turn).toMatchObject({ interestThread: replyToInterestThread });
});
it('rejects missing consent, invalid shape, hidden identifiers, C1/control and invalid unicode', () => {
  for (const c of [{ ...command, confirmed: false }, { ...command, providerKey: 'secret' }, { ...command, expected: { threadId: 't', revision: 0 } }, ...[' ', ' x', 'x'.repeat(161), '\u000b', 'x\u0085y', '\ud800'].map(text => ({ ...command, text }))]) expect(() => parseInterestThreadCommand(c)).toThrow();
  expect(() => parseInterestThreadReadResult({ ok: true, generation: 0, value: { ref: { threadId: 't', revision: 1 }, state: 'closed', text: 'secret', confirmedAt: '2026-10-20T00:00:00.000Z', expiresAt: '2026-10-27T00:00:00.000Z', attempted: true } })).toThrow();
});
