import { describe, it, expect } from 'vitest';
import { sanitizeUserMessage } from '../../src/domain/chat/chat-message';

describe('Domain: User message normalization', () => {
  it('sanitizes user input and enforces maxLength', () => {
    expect(sanitizeUserMessage('   Как дела?   ')).toBe('Как дела?');
    const longInput = 'X'.repeat(300);
    expect(sanitizeUserMessage(longInput, 100).length).toBe(100);
  });
});
