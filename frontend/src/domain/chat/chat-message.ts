/**
 * Chat message contracts and user input normalization
 * Pure deterministic definitions shared by dialogue presentation.
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
 * Sanitizes input text from the user.
 */
export function sanitizeUserMessage(rawText: string, maxLength = 240): string {
  if (!rawText) return '';
  return rawText.trim().substring(0, maxLength);
}
