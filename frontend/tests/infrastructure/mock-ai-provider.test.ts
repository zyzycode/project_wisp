import { describe, it, expect } from 'vitest';
import { MockAIProvider } from '../../src/infrastructure/ai/mock-ai-provider';
import {
  CATEGORY_TEMPLATES,
  DEFAULT_FALLBACK_TEMPLATE,
} from '../../src/infrastructure/ai/mock-response-catalog';
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
      needs: {
        energy: 90,
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

  it('keeps category coverage and default fallback', () => {
    expect(Object.keys(CATEGORY_TEMPLATES)).toEqual([
      'greeting',
      'question',
      'care',
      'play',
      'sleep',
      'unknown',
    ]);
    expect(DEFAULT_FALLBACK_TEMPLATE.text).toBe(
      '*Мерцает мягким светом* Я пока не всё знаю, но всегда рядом с тобой!'
    );
  });

  it.each([
    ['greeting', 'Привет', 'react_happy', 4],
    ['question', 'Почему?', 'respond', 4],
    ['care', 'Обнять', 'react_happy', 4],
    ['play', 'Поиграем', 'play', 4],
    ['sleep', 'Спать', 'sleep', 4],
    ['unknown', 'Сегодня отличный день', 'respond', 8],
  ])('varies %s replies across requests while keeping reproducible localized semantics', async (
    _category, text, behavior, minimumReplies
  ) => {
    const provider = new MockAIProvider({ simulatedLatencyMs: 0 });
    const freshProvider = new MockAIProvider({ simulatedLatencyMs: 0 });
    for (const locale of ['ru', 'en']) {
      const replies = new Set<string>();
      for (let index = 0; index < 32; index++) {
        const request = { ...createRequest(text, `dialogue-${index}`), locale };
        const response = await provider.generateResponse(request);
        const repeated = await freshProvider.generateResponse(request);
        expect(response.status).toBe('ok');
        expect(response.suggestedBehavior).toBe(behavior);
        expect(response.diagnostics?.provider).toBe('mock');
        expect(/[А-Яа-яЁё]/u.test(response.reply.text)).toBe(locale === 'ru');
        expect(repeated.reply).toEqual(response.reply);
        expect(repeated.suggestedMood).toBe(response.suggestedMood);
        expect(repeated.confidence).toBe(response.confidence);
        replies.add(response.reply.text);
      }
      expect(replies.size).toBeGreaterThanOrEqual(minimumReplies);
    }
  });

  it('initializes with default status ready', async () => {
    const provider = new MockAIProvider({ simulatedLatencyMs: 0 });
    const status = await provider.getStatus();

    expect(status.kind).toBe('ready');
    expect(status.activeRequestId).toBeUndefined();
  });

  describe('Response locale', () => {
    it.each([
      ['greeting', 'Привет', 'Hello'],
      ['question', 'Почему?', 'Why?'],
      ['care', 'Обнять', 'Hug'],
      ['play', 'Поиграем', 'Play'],
      ['sleep', 'Спать', 'Sleep'],
      ['unknown', 'абвгд 42', 'xyz 42'],
    ])('uses the requested language for %s regardless of requestId or input language', async (_category, russian, english) => {
      const provider = new MockAIProvider({ simulatedLatencyMs: 0 });
      for (const locale of ['ru', 'en']) {
        for (const requestId of ['a', 'b']) {
          for (const text of [russian, english]) {
            const request = { ...createRequest(text, requestId), locale };
            const response = await provider.generateResponse(request);
            expect(response.status).toBe('ok');
            expect(/[А-Яа-яЁё]/u.test(response.reply.text)).toBe(locale === 'ru');
            const repeated = await provider.generateResponse(request);
            expect(repeated.reply).toEqual(response.reply);
            expect(repeated.suggestedBehavior).toBe(response.suggestedBehavior);
            expect(repeated.suggestedMood).toBe(response.suggestedMood);
          }
        }
      }
    });

    it.each([undefined, '', 'unsupported'])('defaults locale %s to Russian', async (locale) => {
      const provider = new MockAIProvider({ simulatedLatencyMs: 0 });
      const response = await provider.generateResponse({ ...createRequest('Hello', 'a'), locale });
      const russianResponse = await provider.generateResponse({ ...createRequest('Hello', 'a'), locale: 'ru' });
      expect(response.reply).toEqual(russianResponse.reply);
      expect(/[А-Яа-яЁё]/u.test(response.reply.text)).toBe(true);
    });

    it.each(['ru', 'en'])('localizes the too-long fallback for %s', async (locale) => {
      const provider = new MockAIProvider({ simulatedLatencyMs: 0, maxMessageLength: 10 });
      const response = await provider.generateResponse({ ...createRequest('x'.repeat(11)), locale });
      expect(response.status).toBe('fallback');
      expect(response.diagnostics?.fallbackReason).toBe('message_too_long');
      expect(/[А-Яа-яЁё]/u.test(response.reply.text)).toBe(locale === 'ru');
    });
  });

  describe('Category detection & responses', () => {
    it('handles greeting messages in Russian, English and various casings', async () => {
      const provider = new MockAIProvider({ simulatedLatencyMs: 0 });

      // Russian greeting variants
      const ru1 = await provider.generateResponse(createRequest('Привет, Wisp!'));
      expect(ru1.status).toBe('ok');
      expect(ru1.suggestedBehavior).toBe('react_happy');
      expect(ru1.suggestedMood).toBe('happy');
      expect(ru1.diagnostics?.provider).toBe('mock');

      const ru2 = await provider.generateResponse(createRequest('доброе утро'));
      expect(ru2.status).toBe('ok');
      expect(ru2.suggestedBehavior).toBe('react_happy');

      const ru3 = await provider.generateResponse(createRequest('ДОБРЫЙ ДЕНЬ'));
      expect(ru3.status).toBe('ok');
      expect(ru3.suggestedBehavior).toBe('react_happy');

      const ru4 = await provider.generateResponse(createRequest('здравствуй маленький огонек'));
      expect(ru4.status).toBe('ok');
      expect(ru4.suggestedBehavior).toBe('react_happy');

      // English greeting variants
      const en1 = await provider.generateResponse(createRequest('Hello friend!'));
      expect(en1.status).toBe('ok');
      expect(en1.suggestedBehavior).toBe('react_happy');

      const en2 = await provider.generateResponse(createRequest('howdy partner'));
      expect(en2.status).toBe('ok');
      expect(en2.suggestedBehavior).toBe('react_happy');

      const en3 = await provider.generateResponse(createRequest('HEY!'));
      expect(en3.status).toBe('ok');
      expect(en3.suggestedBehavior).toBe('react_happy');
    });

    it('handles question messages with question marks and interrogative words', async () => {
      const provider = new MockAIProvider({ simulatedLatencyMs: 0 });

      const q1 = await provider.generateResponse(createRequest('Как твои дела?'));
      expect(q1.status).toBe('ok');
      expect(q1.reply.tone).toBe('curious');
      expect(q1.suggestedMood).toBe('curious');
      expect(q1.suggestedBehavior).toBe('respond');

      const q2 = await provider.generateResponse(createRequest('Why is the sky blue'));
      expect(q2.status).toBe('ok');
      expect(q2.reply.tone).toBe('curious');
      expect(q2.suggestedBehavior).toBe('respond');

      const q3 = await provider.generateResponse(createRequest('почему мерцают звезды'));
      expect(q3.status).toBe('ok');
      expect(q3.reply.tone).toBe('curious');
      expect(q3.suggestedBehavior).toBe('respond');

      const q4 = await provider.generateResponse(createRequest('Расскажи где ты живешь'));
      expect(q4.status).toBe('ok');
      expect(q4.suggestedBehavior).toBe('respond');
    });

    it('handles care messages with affectionate words', async () => {
      const provider = new MockAIProvider({ simulatedLatencyMs: 0 });

      const res1 = await provider.generateResponse(createRequest('Хочу тебя погладить и обнять'));
      expect(res1.status).toBe('ok');
      expect(res1.reply.tone).toBe('warm');
      expect(res1.suggestedMood).toBe('happy');
      expect(res1.suggestedBehavior).toBe('react_happy');

      const res2 = await provider.generateResponse(createRequest('Ты умница, вот тебе печенька'));
      expect(res2.status).toBe('ok');
      expect(res2.suggestedBehavior).toBe('react_happy');

      const res3 = await provider.generateResponse(createRequest('I love you, snuggle closer'));
      expect(res3.status).toBe('ok');
      expect(res3.suggestedBehavior).toBe('react_happy');
    });

    it('handles play messages', async () => {
      const provider = new MockAIProvider({ simulatedLatencyMs: 0 });

      const res1 = await provider.generateResponse(createRequest('Давай играть в мячик!'));
      expect(res1.status).toBe('ok');
      expect(res1.reply.tone).toBe('playful');
      expect(res1.suggestedMood).toBe('happy');
      expect(res1.suggestedBehavior).toBe('play');

      const res2 = await provider.generateResponse(createRequest('Поиграем вместе, попрыгай'));
      expect(res2.status).toBe('ok');
      expect(res2.suggestedBehavior).toBe('play');

      const res3 = await provider.generateResponse(createRequest('Let us dance and have fun game'));
      expect(res3.status).toBe('ok');
      expect(res3.suggestedBehavior).toBe('play');
    });

    it('handles sleep messages', async () => {
      const provider = new MockAIProvider({ simulatedLatencyMs: 0 });

      const res1 = await provider.generateResponse(createRequest('Я устал, пора спать, спокойной ночи'));
      expect(res1.status).toBe('ok');
      expect(res1.reply.tone).toBe('sleepy');
      expect(res1.suggestedMood).toBe('sleepy');
      expect(res1.suggestedBehavior).toBe('sleep');

      const res2 = await provider.generateResponse(createRequest('Отдохни и засыпай'));
      expect(res2.status).toBe('ok');
      expect(res2.suggestedBehavior).toBe('sleep');

      const res3 = await provider.generateResponse(createRequest('Time to take a nap, goodnight'));
      expect(res3.status).toBe('ok');
      expect(res3.suggestedBehavior).toBe('sleep');
    });

    it('handles unknown messages gracefully with fallback template', async () => {
      const provider = new MockAIProvider({ simulatedLatencyMs: 0 });

      const res = await provider.generateResponse(createRequest('абвгд xyz 42 998877'));
      expect(res.status).toBe('ok');
      expect(res.suggestedBehavior).toBe('respond');
      expect(res.reply.text).toBeDefined();
      expect(res.reply.text.length).toBeGreaterThan(0);
      expect(res.confidence).toBe(0.7);
    });
  });

  describe('Fallback scenarios', () => {
    it('returns fallback on empty, whitespace, or newline input', async () => {
      const provider = new MockAIProvider({ simulatedLatencyMs: 0 });

      const emptyRes = await provider.generateResponse(createRequest('   '));
      expect(emptyRes.status).toBe('fallback');
      expect(emptyRes.diagnostics?.fallbackReason).toBe('empty_input');
      expect(emptyRes.suggestedMood).toBe('confused');
      expect(emptyRes.suggestedBehavior).toBe('react_confused');

      const newlineRes = await provider.generateResponse(createRequest('\n\t  \r\n'));
      expect(newlineRes.status).toBe('fallback');
      expect(newlineRes.diagnostics?.fallbackReason).toBe('empty_input');
    });

    it('returns fallback when message exceeds maxMessageLength boundary', async () => {
      const maxLen = 10;
      const provider = new MockAIProvider({
        simulatedLatencyMs: 0,
        maxMessageLength: maxLen,
      });

      // Exactly at limit -> OK
      const atLimit = await provider.generateResponse(createRequest('1234567890'));
      expect(atLimit.status).toBe('ok');

      // Exceeds limit by 1 -> fallback
      const overLimit = await provider.generateResponse(createRequest('12345678901'));
      expect(overLimit.status).toBe('fallback');
      expect(overLimit.diagnostics?.fallbackReason).toBe('message_too_long');
      expect(overLimit.suggestedMood).toBe('confused');
      expect(overLimit.suggestedBehavior).toBe('react_confused');
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

  describe('Boundary & Contract compliance', () => {
    it('never suggests restricted behaviors like drag or land', async () => {
      const provider = new MockAIProvider({ simulatedLatencyMs: 0 });
      const testInputs = [
        'привет',
        'как дела?',
        'поиграем',
        'хочу спать',
        'погладить',
        'абвгд random',
        '',
        'x'.repeat(600),
      ];

      for (const input of testInputs) {
        const res = await provider.generateResponse(createRequest(input));
        expect(res.suggestedBehavior).not.toBe('drag');
        expect(res.suggestedBehavior).not.toBe('land');
      }
    });

    it('returns pure semantic DTO without UI/DOM/render properties', async () => {
      const provider = new MockAIProvider({ simulatedLatencyMs: 0 });
      const res = await provider.generateResponse(createRequest('Привет!'));

      const forbiddenKeys = [
        'className',
        'style',
        'component',
        'element',
        'assetPath',
        'frameIndex',
        'fps',
        'svgPath',
      ];

      for (const key of forbiddenKeys) {
        expect(res).not.toHaveProperty(key);
      }
    });
  });
});
