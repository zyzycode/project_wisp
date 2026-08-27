import { describe, it, expect } from 'vitest';
import {
  calculateBubbleDisplayDuration,
  createChatMessage,
  sanitizeUserMessage,
} from '../../src/domain/chat/chat-message';

describe('Domain: Chat Message & Speech Bubble', () => {
  it('calculates dynamic display duration based on text length', () => {
    expect(calculateBubbleDisplayDuration('')).toBe(3500);
    expect(calculateBubbleDisplayDuration('Привет!')).toBe(4200);
    // Very long string should be capped at max duration 9000ms
    const longText = 'А'.repeat(200);
    expect(calculateBubbleDisplayDuration(longText)).toBe(9000);
  });

  it('creates chat message with correct defaults', () => {
    const msg = createChatMessage('pet', 'Привет, хозяин!', 'test_1', 1000);
    expect(msg.id).toBe('test_1');
    expect(msg.sender).toBe('pet');
    expect(msg.text).toBe('Привет, хозяин!');
    expect(msg.timestamp).toBe(1000);
    expect(msg.durationMs).toBeGreaterThanOrEqual(3500);
  });

  it('sanitizes user input and enforces maxLength', () => {
    expect(sanitizeUserMessage('   Как дела?   ')).toBe('Как дела?');
    const longInput = 'X'.repeat(300);
    expect(sanitizeUserMessage(longInput, 100).length).toBe(100);
  });
});
