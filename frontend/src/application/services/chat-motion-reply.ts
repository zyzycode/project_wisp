import type { ChatMotionCommand, ChatMotionReceipt, ChatMotionTerminal } from '../ports/chat-motion';
import { localDialogueText } from './dialogue-local-text';

export function chatMotionReply(receipt: ChatMotionReceipt, command: ChatMotionCommand, en: boolean): string {
  const locale = en ? 'en' : 'ru';
  if (receipt.status === 'started') return localDialogueText(command.kind === 'move' && command.direction === 'right' ? 'motion_right' : 'motion_left', locale);
  if (receipt.status === 'stopped') return localDialogueText(receipt.hadActiveRun ? 'motion_stopped' : 'motion_inactive', locale);
  return localDialogueText(receipt.reason === 'invalid_request' ? 'motion_clarify' : `motion_${receipt.reason}`, locale);
}

export function chatMotionTerminalReply(event: ChatMotionTerminal, en: boolean): string {
  const locale = en ? 'en' : 'ru';
  if (event.status === 'completed') return localDialogueText('motion_completed', locale);
  return localDialogueText(event.reason === 'critical_need' ? 'motion_critical_need' : `motion_cancel_${event.reason}`, locale);
}
