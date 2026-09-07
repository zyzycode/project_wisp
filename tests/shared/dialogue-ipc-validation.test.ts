import { expect, it } from 'vitest';
import { parseDialogueCommand, parseDialoguePresentation, parseDialogueReceipt } from '../../src/shared/dialogue-ipc-validation';
const command = { type: 'send', streamId: 'stream', conversationId: 'conversation', sequence: 1, text: ' Привет ' };
it('copies the exact command and sanitizes text', () => { expect(parseDialogueCommand(command)).toEqual({ ...command, text: 'Привет' }); });
it.each([{ ...command, extra: 1 }, { ...command, sequence: 0 }, { ...command, sequence: Infinity }, { ...command, streamId: ' ' },
  { ...command, text: ' ' }, { ...command, text: 'x'.repeat(241) }, { ...command, text: '\u0001' }, { ...command, type: 'reset' },
  Object.defineProperty({ ...command }, 'text', { get: () => 'side effect' }),
])('rejects malformed command %j', value => expect(() => parseDialogueCommand(value)).toThrow());
it('validates reset, receipt and all presentation variants with no extra keys', () => {
  expect(parseDialogueCommand({ type: 'reset', streamId: 's', conversationId: 'c', sequence: 2 }).type).toBe('reset');
  expect(parseDialogueReceipt({ status: 'accepted', conversationId: 'c' })).toEqual({ status: 'accepted', conversationId: 'c' });
  expect(() => parseDialogueReceipt({ status: 'accepted', conversationId: 'c', replyText: 'bad' })).toThrow();
  for (const turn of [{ phase: 'idle' }, { phase: 'thinking', requestId: 'r' }, { phase: 'error', requestId: 'r', message: 'Ошибка' },
    { phase: 'completed', requestId: 'r', replyText: 'Ответ', outcome: { kind: 'success' } },
    { phase: 'completed', requestId: 'r', replyText: 'Ответ', outcome: { kind: 'fallback', reason: 'offline' } }]) {
    expect(parseDialoguePresentation({ conversationId: 'c', canSubmit: false, turn }).turn).toEqual(turn);
    expect(() => parseDialoguePresentation({ conversationId: 'c', canSubmit: false, turn: { ...turn, extra: true } })).toThrow();
  }
  expect(() => parseDialoguePresentation({ conversationId: 'c', canSubmit: true, turn: { phase: 'thinking', requestId: 'r' } })).toThrow();
});
