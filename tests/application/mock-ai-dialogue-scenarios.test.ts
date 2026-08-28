import { describe, it, expect } from 'vitest';
import { MockAIProvider } from '../../src/infrastructure/ai/mock-ai-provider';
import type {
  AIProviderRequest,
  AIProviderResponse,
  IAIProvider,
  ProviderSuggestedBehaviorKind,
} from '../../src/application/ports/ai-provider.interface';
import type {
  BehaviorIntent,
  BehaviorIntentKind,
} from '../../src/domain/behavior/behavior-intent';
import { mapProviderResponseToBehaviorIntent } from '../../src/application/services/provider-response-intent-mapper';

export { mapProviderResponseToBehaviorIntent };
export type { BehaviorIntent, BehaviorIntentKind };

describe('Application: MockAI Dialogue Scenarios & Intent Mapping', () => {
  const createRequest = (text: string, requestId = 'req-dialogue-1'): AIProviderRequest => ({
    requestId,
    userMessage: {
      id: `msg-${requestId}`,
      text,
      createdAt: new Date().toISOString(),
    },
    characterSnapshot: {
      needs: {
        energy: 85,
        attention: 30,
        play: 30,
        comfort: 20,
      },
      relationship: {
        friendship: 0,
        love: 0,
        loveUnlocked: false,
      },
      personality: {
        presetId: 'shyDreamGirl',
        aiSelfConcept:
          'Wisp is a shy, gentle, emotionally sensitive anime-like companion.',
        traits: {
          shyness: 0.55,
          playfulness: 0.42,
          sensitivity: 0.88,
          boldness: 0.18,
        },
      },
      intimacy: {
        flirtiness: 0,
        romanticCharge: 0,
        userConsentEnabled: false,
      },
      synthesizedTone: 'neutral',
    },
    recentContext: [],
    locale: 'ru',
  });

  const provider: IAIProvider = new MockAIProvider({ simulatedLatencyMs: 0 });

  describe('Core dialogue scenario mappings', () => {
    it('maps greeting response to react_happy BehaviorIntent', async () => {
      const response = await provider.generateResponse(createRequest('Привет, Wisp!'));
      expect(response.status).toBe('ok');

      const intent = mapProviderResponseToBehaviorIntent(response);
      expect(intent.kind).toBe('react_happy');
      expect(intent.source).toBe('provider');
      expect(intent.priority).toBe('normal');
      expect(intent.moodHint).toBe('happy');
      expect(intent.replyText).toContain('Wisp');
      expect(intent.requestId).toBe('req-dialogue-1');
    });

    it('maps question response to respond BehaviorIntent with curious mood', async () => {
      const response = await provider.generateResponse(createRequest('Почему трава зелёная?'));
      expect(response.status).toBe('ok');

      const intent = mapProviderResponseToBehaviorIntent(response);
      expect(intent.kind).toBe('respond');
      expect(intent.source).toBe('provider');
      expect(intent.moodHint).toBe('curious');
      expect(intent.replyText).toBeDefined();
    });

    it('maps play response to play BehaviorIntent', async () => {
      const response = await provider.generateResponse(createRequest('Давай поиграем в мячик!'));
      expect(response.status).toBe('ok');

      const intent = mapProviderResponseToBehaviorIntent(response);
      expect(intent.kind).toBe('play');
      expect(intent.source).toBe('provider');
      expect(intent.moodHint).toBe('happy');
      expect(intent.replyText).toBeDefined();
    });

    it('maps sleep response to sleep BehaviorIntent with sleepy mood', async () => {
      const response = await provider.generateResponse(createRequest('Пора спать, спокойной ночи'));
      expect(response.status).toBe('ok');

      const intent = mapProviderResponseToBehaviorIntent(response);
      expect(intent.kind).toBe('sleep');
      expect(intent.source).toBe('provider');
      expect(intent.moodHint).toBe('sleepy');
      expect(intent.replyText).toBeDefined();
    });

    it('maps care response to react_happy BehaviorIntent', async () => {
      const response = await provider.generateResponse(createRequest('Хочу тебя погладить'));
      expect(response.status).toBe('ok');

      const intent = mapProviderResponseToBehaviorIntent(response);
      expect(intent.kind).toBe('react_happy');
      expect(intent.source).toBe('provider');
      expect(intent.moodHint).toBe('happy');
      expect(intent.replyText).toBeDefined();
    });

    it('maps unknown user input gracefully to respond BehaviorIntent', async () => {
      const response = await provider.generateResponse(createRequest('неизвестная команда 98765'));
      expect(response.status).toBe('ok');

      const intent = mapProviderResponseToBehaviorIntent(response);
      expect(intent.kind).toBe('respond');
      expect(intent.source).toBe('provider');
      expect(intent.replyText).toBeDefined();
    });
  });

  describe('Fallback intent mappings', () => {
    it('maps empty_input fallback response to react_confused BehaviorIntent', async () => {
      const response = await provider.generateResponse(createRequest('   '));
      expect(response.status).toBe('fallback');
      expect(response.diagnostics?.fallbackReason).toBe('empty_input');

      const intent = mapProviderResponseToBehaviorIntent(response);
      expect(intent.kind).toBe('react_confused');
      expect(intent.source).toBe('provider');
      expect(intent.moodHint).toBe('confused');
      expect(intent.reason).toBe('empty_input');
    });

    it('maps message_too_long fallback response to react_confused BehaviorIntent', async () => {
      const smallProvider = new MockAIProvider({ simulatedLatencyMs: 0, maxMessageLength: 15 });
      const response = await smallProvider.generateResponse(createRequest('Это длинный текст который превышает лимит'));
      expect(response.status).toBe('fallback');
      expect(response.diagnostics?.fallbackReason).toBe('message_too_long');

      const intent = mapProviderResponseToBehaviorIntent(response);
      expect(intent.kind).toBe('react_confused');
      expect(intent.source).toBe('provider');
      expect(intent.moodHint).toBe('confused');
      expect(intent.reason).toBe('message_too_long');
    });

    it('filters out unsafe/forbidden provider gestures like drag or land to safe default', () => {
      const spoofedResponse: AIProviderResponse = {
        requestId: 'req-spoof',
        status: 'ok',
        reply: { text: 'Spoofed' },
        suggestedBehavior: 'drag' as unknown as ProviderSuggestedBehaviorKind,
        confidence: 0.9,
      };

      const intent = mapProviderResponseToBehaviorIntent(spoofedResponse);
      expect(intent.kind).toBe('respond');
      expect(intent.kind).not.toBe('drag');
    });
  });

  describe('Dialogue flow & status isolation', () => {
    it('verifies provider status transitions during thinking flow without leaking to UI', async () => {
      const delayedProvider = new MockAIProvider({ simulatedLatencyMs: 20 });

      const requestPromise = delayedProvider.generateResponse(createRequest('Привет', 'req-lifecycle'));

      // In-flight status check
      const statusDuringThinking = await delayedProvider.getStatus();
      expect(statusDuringThinking.kind).toBe('thinking');
      expect(statusDuringThinking.activeRequestId).toBe('req-lifecycle');

      const response = await requestPromise;
      expect(response.status).toBe('ok');

      // Post-flight status check
      const statusAfterThinking = await delayedProvider.getStatus();
      expect(statusAfterThinking.kind).toBe('ready');
      expect(statusAfterThinking.activeRequestId).toBeUndefined();
    });
  });
});
