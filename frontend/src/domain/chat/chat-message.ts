/**
 * Chat message contracts
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
