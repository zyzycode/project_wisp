import { describe, it, expect, vi } from 'vitest';
import { calculateBubbleDisplayDuration, createChatMessage } from '../../src/renderer/render-engine/chat-message-presentation';

describe('Renderer: Chat message presentation', () => {
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

  it('uses presentation time and identity for local messages', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1000);
      const message = createChatMessage('thought', '  Hello  ');
      expect(message).toMatchObject({ sender: 'thought', text: 'Hello', timestamp: 1000, durationMs: 4000 });
      expect(message.id).toMatch(/^msg_1000_/u);
    } finally { vi.useRealTimers(); }
  });
});
