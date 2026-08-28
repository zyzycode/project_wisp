import { describe, it, expect } from 'vitest';
import { MockAIProvider } from '../../src/infrastructure/ai/mock-ai-provider';
import type { AIProviderRequest } from '../../src/application/ports/ai-provider.interface';

describe('Infrastructure: MockAIProvider', () => {
  const createRequest = (text: string, requestId = 'req-test-1'): AIProviderRequest => ({
    requestId,
    userMessage: {
      id: 'msg-1',
      text,
      createdAt: new Date().toISOString(),
    },
    characterSnapshot: {
      mood: 'neutral',
      energy: 90,
      activity: 'idle',
      focus: 'user',
    },
    recentContext: [],
    locale: 'ru',
  });

  it('initializes with default status ready', async () => {
    const provider = new MockAIProvider({ simulatedLatencyMs: 0 });
    const status = await provider.getStatus();

    expect(status.kind).toBe('ready');
    expect(status.activeRequestId).toBeUndefined();
  });

  describe('Category detection & responses', () => {
    it('handles greeting messages', async () => {
      const provider = new MockAIProvider({ simulatedLatencyMs: 0 });

      const ruResponse = await provider.generateResponse(createRequest('Привет, Wisp!'));
      expect(ruResponse.status).toBe('ok');
      expect(ruResponse.suggestedBehavior).toBe('react_happy');
      expect(ruResponse.suggestedMood).toBe('happy');
      expect(ruResponse.diagnostics?.provider).toBe('mock');

      const enResponse = await provider.generateResponse(createRequest('Hello friend!'));
      expect(enResponse.status).toBe('ok');
      expect(enResponse.suggestedBehavior).toBe('react_happy');
    });

    it('handles question messages', async () => {
      const provider = new MockAIProvider({ simulatedLatencyMs: 0 });

      const q1 = await provider.generateResponse(createRequest('Как твои дела?'));
      expect(q1.status).toBe('ok');
      expect(q1.reply.tone).toBe('curious');
      expect(q1.suggestedMood).toBe('curious');
      expect(q1.suggestedBehavior).toBe('respond');

      const q2 = await provider.generateResponse(createRequest('Why is the sky blue'));
      expect(q2.status).toBe('ok');
      expect(q2.reply.tone).toBe('curious');
    });

    it('handles care messages', async () => {
      const provider = new MockAIProvider({ simulatedLatencyMs: 0 });

      const res = await provider.generateResponse(createRequest('Хочу тебя погладить и обнять'));
      expect(res.status).toBe('ok');
      expect(res.reply.tone).toBe('warm');
      expect(res.suggestedMood).toBe('happy');
      expect(res.suggestedBehavior).toBe('react_happy');
    });

    it('handles play messages', async () => {
      const provider = new MockAIProvider({ simulatedLatencyMs: 0 });

      const res = await provider.generateResponse(createRequest('Давай играть в мячик!'));
      expect(res.status).toBe('ok');
      expect(res.reply.tone).toBe('playful');
      expect(res.suggestedMood).toBe('happy');
      expect(res.suggestedBehavior).toBe('play');
    });

    it('handles sleep messages', async () => {
      const provider = new MockAIProvider({ simulatedLatencyMs: 0 });

      const res = await provider.generateResponse(createRequest('Я устал, пора спать, спокойной ночи'));
      expect(res.status).toBe('ok');
      expect(res.reply.tone).toBe('sleepy');
      expect(res.suggestedMood).toBe('sleepy');
      expect(res.suggestedBehavior).toBe('sleep');
    });

    it('handles unknown messages gracefully', async () => {
      const provider = new MockAIProvider({ simulatedLatencyMs: 0 });

      const res = await provider.generateResponse(createRequest('абвгд xyz 42'));
      expect(res.status).toBe('ok');
      expect(res.suggestedBehavior).toBe('respond');
      expect(res.reply.text).toBeDefined();
    });
  });

  describe('Fallback scenarios', () => {
    it('returns fallback on empty or whitespace-only input', async () => {
      const provider = new MockAIProvider({ simulatedLatencyMs: 0 });

      const emptyRes = await provider.generateResponse(createRequest('   '));
      expect(emptyRes.status).toBe('fallback');
      expect(emptyRes.diagnostics?.fallbackReason).toBe('empty_input');
      expect(emptyRes.suggestedMood).toBe('confused');
      expect(emptyRes.suggestedBehavior).toBe('react_confused');
    });

    it('returns fallback when message exceeds maxMessageLength', async () => {
      const provider = new MockAIProvider({
        simulatedLatencyMs: 0,
        maxMessageLength: 20,
      });

      const longText = 'Это очень длинное сообщение, которое превышает установленный лимит';
      const longRes = await provider.generateResponse(createRequest(longText));

      expect(longRes.status).toBe('fallback');
      expect(longRes.diagnostics?.fallbackReason).toBe('message_too_long');
      expect(longRes.suggestedMood).toBe('confused');
      expect(longRes.suggestedBehavior).toBe('react_confused');
    });
  });

  describe('Status & latency lifecycle', () => {
    it('switches status to thinking during execution and back to ready', async () => {
      const provider = new MockAIProvider({ simulatedLatencyMs: 30 });

      const promise = provider.generateResponse(createRequest('Привет', 'req-async-1'));

      // Check immediate status during in-flight request
      const thinkingStatus = await provider.getStatus();
      expect(thinkingStatus.kind).toBe('thinking');
      expect(thinkingStatus.activeRequestId).toBe('req-async-1');

      const response = await promise;
      expect(response.status).toBe('ok');
      expect(response.diagnostics?.latencyMs).toBeGreaterThanOrEqual(25);

      // Status should be ready again
      const finalStatus = await provider.getStatus();
      expect(finalStatus.kind).toBe('ready');
      expect(finalStatus.activeRequestId).toBeUndefined();
    });
  });
});
