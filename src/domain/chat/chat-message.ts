/**
 * Domain Model: Chat Message & Speech Bubble
 * Pure domain definitions for messages, sender roles, bubble display durations,
 * and text formatting. Zero OS / Electron dependencies.
 */

export type MessageSender = 'user' | 'pet' | 'thought';

export interface ChatMessage {
  id: string;
  sender: MessageSender;
  text: string;
  timestamp: number;
  durationMs?: number;
}

/**
 * Calculates how long a speech bubble should stay visible based on word count.
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
 * Creates a valid ChatMessage entity with timestamps and automatic reading duration.
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

/**
 * Sanitizes input text from the user.
 */
export function sanitizeUserMessage(rawText: string, maxLength = 240): string {
  if (!rawText) return '';
  return rawText.trim().substring(0, maxLength);
}
