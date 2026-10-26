import { createCharacterSnapshot } from '../../src/domain/character/character-snapshot';
import { CharacterStateService } from '../../src/application/services/character-state.service';
import { describe, it, expect, vi } from 'vitest';
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

  it.each([
    ['greeting', 'Привет', 'react_happy', 4],
    ['care', 'Хочу тебя обнять', 'react_happy', 4],
    ['play', 'Поиграем', 'play', 4],
    ['sleep', 'Спать', 'sleep', 4],
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

  describe('Response locale', () => {
    it.each([
      ['greeting', 'Привет', 'Hello'],
      ['care', 'Хочу тебя обнять', 'I want to hug you'],
      ['play', 'Поиграем', 'Play'],
      ['sleep', 'Спать', 'Sleep'],
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

    it('handles care messages with affectionate words', async () => {
      const provider = new MockAIProvider({ simulatedLatencyMs: 0 });

      const res1 = await provider.generateResponse(createRequest('Хочу тебя погладить'));
      expect(res1.status).toBe('ok');
      expect(res1.reply.tone).toBe('warm');
      expect(res1.suggestedMood).toBe('happy');
      expect(res1.suggestedBehavior).toBe('react_happy');

      const res2 = await provider.generateResponse(createRequest('Ты умница, вот тебе печенька'));
      expect(res2.status).toBe('ok');
      expect(res2.suggestedBehavior).toBe('react_happy');

      const res3 = await provider.generateResponse(createRequest('I love you'));
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

      const res2 = await provider.generateResponse(createRequest('Поиграем вместе'));
      expect(res2.status).toBe('ok');
      expect(res2.suggestedBehavior).toBe('play');

      const res3 = await provider.generateResponse(createRequest('Let us play'));
      expect(res3.status).toBe('ok');
      expect(res3.suggestedBehavior).toBe('play');
    });

    it('handles sleep messages', async () => {
      const provider = new MockAIProvider({ simulatedLatencyMs: 0 });

      const res1 = await provider.generateResponse(createRequest('Иди спать'));
      expect(res1.status).toBe('ok');
      expect(res1.reply.tone).toBe('sleepy');
      expect(res1.suggestedMood).toBe('sleepy');
      expect(res1.suggestedBehavior).toBe('sleep');

      const res2 = await provider.generateResponse(createRequest('Отдохни'));
      expect(res2.status).toBe('ok');
      expect(res2.suggestedBehavior).toBe('sleep');

      const res3 = await provider.generateResponse(createRequest('Take a nap'));
      expect(res3.status).toBe('ok');
      expect(res3.suggestedBehavior).toBe('sleep');
    });

    it('handles unknown messages gracefully with fallback template', async () => {
      const provider = new MockAIProvider({ simulatedLatencyMs: 0 });

      const res = await provider.generateResponse(createRequest('абвгд xyz 42 998877'));
      expect(res.status).toBe('fallback');
      expect(res.diagnostics?.fallbackReason).toBe('unsupported_input');
      expect(res.suggestedBehavior).toBe('respond');
      expect(res.reply.text).toBeDefined();
      expect(res.reply.text.length).toBeGreaterThan(0);
      expect(res.confidence).toBe(0.3);
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
      expect(atLimit.diagnostics?.fallbackReason).toBe('unsupported_input');

      // Exceeds limit by 1 -> fallback
      const overLimit = await provider.generateResponse(createRequest('12345678901'));
      expect(overLimit.status).toBe('fallback');
      expect(overLimit.diagnostics?.fallbackReason).toBe('message_too_long');
      expect(overLimit.suggestedMood).toBe('confused');
      expect(overLimit.suggestedBehavior).toBe('react_confused');
    });
  });

  describe('Status & latency lifecycle', () => {
    it('switches ready → thinking → ready on the configured deadline', async () => {
      vi.useFakeTimers();
      try {
        const provider = new MockAIProvider({ simulatedLatencyMs: 30 });
        expect(await provider.getStatus()).toEqual({ kind: 'ready' });
        const promise = provider.generateResponse(createRequest('Привет', 'req-async-1'));
        expect(await provider.getStatus()).toEqual({ kind: 'thinking', activeRequestId: 'req-async-1' });

        await vi.advanceTimersByTimeAsync(29);
        expect(await provider.getStatus()).toMatchObject({ kind: 'thinking' });
        await vi.advanceTimersByTimeAsync(1);
        const response = await promise;
        expect(response.status).toBe('ok');
        expect(response.diagnostics?.latencyMs).toBe(30);
        expect(await provider.getStatus()).toEqual({ kind: 'ready' });
      } finally {
        vi.useRealTimers();
      }
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
  describe('Issue #105: bounded local scenarios', () => {
    it.each([
      ['ru', 'Я не хочу играть'], ['ru', 'Не хочу спать'],
      ['en', "I don't want to play"], ['en', 'I do not want to sleep'],
      ['en', "Don't hug me"], ['ru', 'Не обнимай меня'],
      ['en', 'What does sleep mean?'], ['ru', 'Что значит слово спать?'],
      ['en', 'I fixed a bug in my game'], ['en', 'I bought a new bed'],
      ['ru', 'Ты не устала?'], ['ru', 'Это хороший багрепорт'],
      ['en', 'I care about software quality'], ['ru', 'Привет, что значит game?'],
      ['ru', '2 + 2 = ?'], ['en', 'Why is the sky blue?'],
      ['ru', 'Почему?'], ['en', 'Why?'], ['ru', 'abc xyz 42'],
      ['ru', 'Прыгай'], ['ru', 'Танцуй'], ['en', 'Dance'], ['en', 'Jump'],
      ['ru', 'Обнять'], ['ru', 'Погладить'], ['en', 'Hug'], ['en', 'Pet'],
      ['ru', 'Хочу спать'], ['ru', 'Пора спать'], ['en', 'I am tired'],
      ['ru', 'Не хочу спать, давай играть'], ['en', 'Do not play, sleep instead'],
    ])('honestly declines unsupported %s input: %s', async (locale, text) => {
      const provider = new MockAIProvider({ simulatedLatencyMs: 0 });
      const response = await provider.generateResponse({ ...createRequest(text), locale });
      expect(response).toMatchObject({ status: 'fallback', suggestedBehavior: 'respond',
        reply: { text: locale === 'en' ? "I don't have a suitable reply to that yet." : 'На это у меня пока нет подходящего ответа' },
        diagnostics: { provider: 'mock', fallbackReason: 'unsupported_input' } });
    });
    it.each([['ru', 'Привет🙂'], ['en', 'Hello🙂'], ['ru', 'Привет!🙂'], ['en', 'Hello🙂!']])('recognizes an emoji greeting in %s', async (locale, text) => {
      const response = await new MockAIProvider({ simulatedLatencyMs: 0 }).generateResponse({ ...createRequest(text), locale });
      expect(response).toMatchObject({ status: 'ok', suggestedBehavior: 'react_happy' });
    });
    it.each(['Давай поиграем', 'Поиграй со мной', 'Можешь поиграть со мной?'])('accepts explicit play request: %s', async text => {
      const response = await new MockAIProvider({ simulatedLatencyMs: 0 }).generateResponse(createRequest(text));
      expect(response).toMatchObject({ status: 'ok', suggestedBehavior: 'play' });
    });
    it('does not pretend to answer a contextual follow-up', async () => {
      const provider = new MockAIProvider({ simulatedLatencyMs: 0 });
      for (const text of ['Давай играть', 'Пора спать']) {
        const response = await provider.generateResponse({ ...createRequest('Почему?'), recentContext: [
          { role: 'user', text, createdAt: '2026-10-26T00:00:00.000Z' }, { role: 'wisp', text: 'synthetic previous reply', createdAt: '2026-10-26T00:00:01.000Z' },
        ] });
        expect(response.status).toBe('fallback');
        expect(response.diagnostics?.fallbackReason).toBe('unsupported_input');
      }
    });
    it('declines play when the Domain tone is sleepy instead of attaching sleepy tone to eager play', async () => {
      const request = createRequest('Давай играть'); request.characterSnapshot.synthesizedTone = 'sleepy';
      const response = await new MockAIProvider({ simulatedLatencyMs: 0 }).generateResponse(request);
      expect(response.status).toBe('fallback');
      expect(response.suggestedBehavior).toBe('respond');
    });
    it.each(['sleepy', 'shy', 'affectionate'] as const)('uses the Domain %s tone with a quiet existing greeting', async tone => {
      const request = createRequest('Привет'); request.characterSnapshot.synthesizedTone = tone;
      const response = await new MockAIProvider({ simulatedLatencyMs: 0 }).generateResponse(request);
      expect(response).toMatchObject({ status: 'ok', reply: { tone, text: 'Привет! Устроюсь рядом, пока ты занимаешься своими делами.' }, suggestedMood: tone });
    });
  });

  it('uses actual Domain snapshot synthesis for energy, shyness and friendship without copying thresholds', async () => {
    const state = new CharacterStateService({ now: () => 0 }).getState();
    state.personality.axes.sensitivity.current = 1;
    state.personality.axes.boldness.current = 0;
    state.personality.axes.extraversion.current = 0;
    const provider = new MockAIProvider({ simulatedLatencyMs: 0 });
    const request = createRequest('Привет');
    request.characterSnapshot = createCharacterSnapshot(state);
    expect(request.characterSnapshot.synthesizedTone).toBe('shy');
    expect((await provider.generateResponse(request)).reply.tone).toBe('shy');
    state.relationship.friendship = 1000;
    request.characterSnapshot = createCharacterSnapshot(state);
    expect(request.characterSnapshot.synthesizedTone).toBe('neutral');
    expect((await provider.generateResponse(request)).reply.tone).toBe('warm');
    state.needs = { ...state.needs, energy: 0 };
    request.characterSnapshot = createCharacterSnapshot(state);
    expect(request.characterSnapshot.synthesizedTone).toBe('sleepy');
    expect((await provider.generateResponse(request)).reply.tone).toBe('sleepy');
  });

});
