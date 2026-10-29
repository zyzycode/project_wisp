import { beverageId, parseBeverageProposal } from './beverage-validation';
import { parseInterestThreadRef } from './interest-thread-validation';
import type { DialogueCommandDTO, DialogueCommandReceiptDTO, DialoguePresentationDTO, DialogueFallbackReasonDTO, MemoryCardSourceDTO } from './ipc-contracts';
import { enumValue, exactRecord, plainText } from './validation-primitives';

export { enumValue, exactRecord, plainText } from './validation-primitives';

function id(value: unknown): string { const text = plainText(value, 128); if (text !== text.trim()) throw new TypeError('Invalid id'); return text; }
export function parseDialogueCommand(value: unknown): DialogueCommandDTO {
  const base = exactRecord(value, ['type', 'streamId', 'conversationId', 'sequence'], ['text', 'replyToInterestThread', 'requestBeverageProposal']);
  const type = enumValue(base.type, ['send', 'reset']);
  exactRecord(value, ['type', 'streamId', 'conversationId', 'sequence', ...(type === 'send' ? ['text'] : [])], type === 'send' ? ['replyToInterestThread', 'requestBeverageProposal'] : []);
  if (!Number.isSafeInteger(base.sequence) || typeof base.sequence !== 'number' || base.sequence <= 0) throw new TypeError('Invalid sequence');
  const meta = { streamId: id(base.streamId), conversationId: id(base.conversationId), sequence: base.sequence };
  if (Object.hasOwn(base, 'requestBeverageProposal') && base.requestBeverageProposal !== true) throw new TypeError('Invalid per-turn preference opt-in');
  return type === 'send' ? { ...meta, type, text: plainText(base.text, 240, true), ...(base.requestBeverageProposal === true ? { requestBeverageProposal: true as const } : {}), ...(Object.hasOwn(base, 'replyToInterestThread') ? { replyToInterestThread: parseInterestThreadRef(base.replyToInterestThread) } : {}) } : { ...meta, type };
}
export function parseDialogueReceipt(value: unknown): DialogueCommandReceiptDTO {
  const r = exactRecord(value, ['status'], ['conversationId', 'reason']);
  if (r.status === 'accepted') { exactRecord(r, ['status', 'conversationId']); return { status: 'accepted', conversationId: id(r.conversationId) }; }
  exactRecord(r, ['status', 'reason']); enumValue(r.status, ['rejected']);
  return { status: 'rejected', reason: enumValue(r.reason, ['busy', 'stale', 'invalid_input', 'unavailable']) };
}
export function parseDialoguePresentation(value: unknown): DialoguePresentationDTO {
  const r = exactRecord(value, ['conversationId', 'canSubmit', 'turn'], ['submissionMessage']);
  if (typeof r.canSubmit !== 'boolean') throw new TypeError('Invalid canSubmit');
  if (r.canSubmit && Object.hasOwn(r, 'submissionMessage')) throw new TypeError('Available dialogue cannot have admission notice');
  const meta = { conversationId: id(r.conversationId), canSubmit: r.canSubmit,
    ...(Object.hasOwn(r, 'submissionMessage') ? { submissionMessage: plainText(r.submissionMessage, 240, true) } : {}) };
  const t = exactRecord(r.turn, ['phase'], ['requestId', 'replyText', 'outcome', 'message', 'memorySource', 'interestThread', 'beverageOffer']);
  switch (t.phase) {
    case 'idle': exactRecord(t, ['phase']); return { ...meta, turn: { phase: 'idle' } };
    case 'thinking': exactRecord(t, ['phase', 'requestId']);
      if (r.canSubmit) throw new TypeError('Thinking cannot submit');
      return { ...meta, turn: { phase: 'thinking', requestId: id(t.requestId) } };
    case 'error': exactRecord(t, ['phase', 'requestId', 'message']);
      return { ...meta, turn: { phase: 'error', requestId: id(t.requestId), message: plainText(t.message, 2000) } };
    case 'completed': {
      exactRecord(t, ['phase', 'requestId', 'replyText', 'outcome'], ['memorySource', 'interestThread', 'beverageOffer']);
      const o = exactRecord(t.outcome, ['kind'], ['reason']);
      if (o.kind === 'local') {
        exactRecord(t, ['phase', 'requestId', 'replyText', 'outcome']);
        exactRecord(o, ['kind', 'reason']);
        const local = { phase: 'completed' as const, requestId: id(t.requestId), replyText: plainText(t.replyText, 2000) };
        return enumValue(o.reason, ['quiet_support', 'chat_motion']) === 'chat_motion'
          ? { ...meta, turn: { ...local, outcome: { kind: 'local', reason: 'chat_motion' } } }
          : { ...meta, turn: { ...local, outcome: { kind: 'local', reason: 'quiet_support' } } };
      }
      const kind = enumValue(o.kind, ['success', 'fallback']);
      exactRecord(o, kind === 'success' ? ['kind'] : ['kind', 'reason']);
      const outcome = kind === 'success' ? { kind } : { kind, reason: enumValue<DialogueFallbackReasonDTO>(o.reason, ['degraded', 'offline', 'timeout', 'provider_error', 'invalid_response']) };
      let memorySource: MemoryCardSourceDTO | undefined;
      if (Object.hasOwn(t, 'memorySource')) {
        if (kind !== 'success') throw new TypeError('Fallback cannot provide memory source');
        const source = exactRecord(t.memorySource, ['userMessageId', 'assistantMessageId']);
        memorySource = { userMessageId: id(source.userMessageId), assistantMessageId: id(source.assistantMessageId) };
        if (memorySource.userMessageId === memorySource.assistantMessageId) throw new TypeError('Invalid memory source');
      }
      let beverageOffer;
      if (Object.hasOwn(t, 'beverageOffer')) {
        if (kind !== 'success') throw new TypeError('Fallback cannot offer preference');
        const offer = exactRecord(t.beverageOffer, ['offerId', 'value', 'evidenceQuote']);
        const { offerId, ...proposal } = offer; beverageOffer = { offerId: beverageId(offerId), ...parseBeverageProposal(proposal) };
      }
      return { ...meta, turn: { phase: 'completed', ...(beverageOffer ? { beverageOffer } : {}), ...(Object.hasOwn(t, 'interestThread') ? { interestThread: parseInterestThreadRef(t.interestThread) } : {}), ...(memorySource ? { memorySource } : {}), requestId: id(t.requestId), replyText: plainText(t.replyText, 2000), outcome } };
    }
    default: throw new TypeError('Invalid turn');
  }
}
