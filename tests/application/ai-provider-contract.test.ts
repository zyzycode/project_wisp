import { describe, it, expect } from 'vitest';
import type {
  IAIProvider,
  AIProviderRequest,
  AIProviderResponse,
  AIProviderStatus,
} from '../../src/application/ports/ai-provider.interface';

describe('Application Port: IAIProvider contract', () => {
  it('allows implementing a compliant in-memory mock provider', async () => {
    class TestMockProvider implements IAIProvider {
      private status: AIProviderStatus = { kind: 'ready' };

      async getStatus(): Promise<AIProviderStatus> {
        return this.status;
      }

      async generateResponse(request: AIProviderRequest): Promise<AIProviderResponse> {
        if (!request.userMessage.text.trim()) {
          return {
            requestId: request.requestId,
            status: 'fallback',
            reply: {
              text: '...',
              tone: 'confused',
            },
            suggestedMood: 'confused',
            suggestedBehavior: 'react_confused',
            confidence: 0.2,
            diagnostics: {
              provider: 'mock',
              latencyMs: 5,
              fallbackReason: 'empty_input',
            },
          };
        }

        return {
          requestId: request.requestId,
          status: 'ok',
          reply: {
            text: `Echo: ${request.userMessage.text}`,
            tone: 'warm',
          },
          suggestedMood: 'happy',
          suggestedBehavior: 'respond',
          confidence: 0.95,
          diagnostics: {
            provider: 'mock',
            latencyMs: 10,
          },
        };
      }
    }

    const provider: IAIProvider = new TestMockProvider();

    const initialStatus = await provider.getStatus();
    expect(initialStatus.kind).toBe('ready');

    const okRequest: AIProviderRequest = {
      requestId: 'req-1',
      userMessage: {
        id: 'msg-1',
        text: 'Hello Wisp',
        createdAt: new Date().toISOString(),
      },
      characterSnapshot: {
        needs: {
          energy: 80,
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
      locale: 'en',
    };

    const okResponse = await provider.generateResponse(okRequest);
    expect(okResponse.status).toBe('ok');
    expect(okResponse.reply.text).toBe('Echo: Hello Wisp');
    expect(okResponse.reply.tone).toBe('warm');
    expect(okResponse.suggestedMood).toBe('happy');
    expect(okResponse.suggestedBehavior).toBe('respond');
    expect(okResponse.diagnostics?.provider).toBe('mock');
    expect(okResponse.diagnostics?.latencyMs).toBe(10);

    const emptyRequest: AIProviderRequest = {
      ...okRequest,
      requestId: 'req-2',
      userMessage: {
        id: 'msg-2',
        text: '   ',
        createdAt: new Date().toISOString(),
      },
    };

    const fallbackResponse = await provider.generateResponse(emptyRequest);
    expect(fallbackResponse.status).toBe('fallback');
    expect(fallbackResponse.diagnostics?.fallbackReason).toBe('empty_input');
    expect(fallbackResponse.suggestedBehavior).toBe('react_confused');
  });
});
