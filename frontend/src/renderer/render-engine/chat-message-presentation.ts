import type { ChatMessage, MessageSender } from '../../domain/chat/chat-message';

/**
 * Calculates how long a speech bubble should stay visible based on character count.
 * Minimum 3500ms, plus ~100ms per character to ensure comfortable reading speed.
 */
export function calculateBubbleDisplayDuration(
  text: string,
  minDurationMs = 3500,
  maxDurationMs = 9000
): number {
  if (!text || text.trim().length === 0) {
    return minDurationMs;
  }
  const calculated = minDurationMs + text.length * 100;
  return Math.min(maxDurationMs, calculated);
}

/**
 * Creates a presentation message with timestamps and automatic reading duration.
 */
export function createChatMessage(
  sender: MessageSender,
  text: string,
  id?: string,
  timestamp = Date.now()
): ChatMessage {
  const trimmed = text.trim();
  return {
    id: id ?? `msg_${timestamp}_${Math.random().toString(36).substring(2, 7)}`,
    sender,
    text: trimmed,
    timestamp,
    durationMs: calculateBubbleDisplayDuration(trimmed),
  };
}
