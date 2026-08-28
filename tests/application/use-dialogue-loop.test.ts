import { describe, it, expect, vi } from 'vitest';
import { MockAIProvider } from '../../src/infrastructure/ai/mock-ai-provider';
import {
  processDialogueTurn,
  applyBehaviorIntentToAnimation,
} from '../../src/application/services/dialogue-loop.service';

describe('Application: Dialogue Loop Service & Intent Mapping', () => {
  describe('applyBehaviorIntentToAnimation', () => {
    it('dispatches appropriate animation events for different intents', () => {
      const dispatchAnim = vi.fn();

      // react_happy
      applyBehaviorIntentToAnimation(
        { kind: 'react_happy', source: 'provider', priority: 'normal' },
        dispatchAnim
      );
      expect(dispatchAnim).toHaveBeenLastCalledWith('REACT_HAPPY');

      // react_confused
      applyBehaviorIntentToAnimation(
        { kind: 'react_confused', source: 'provider', priority: 'normal' },
        dispatchAnim
      );
      expect(dispatchAnim).toHaveBeenLastCalledWith('REACT_CONFUSED');

      // sleep
      applyBehaviorIntentToAnimation(
        { kind: 'sleep', source: 'provider', priority: 'normal' },
        dispatchAnim
      );
      expect(dispatchAnim).toHaveBeenLastCalledWith('START_SLEEP');

      // play
      applyBehaviorIntentToAnimation(
        { kind: 'play', source: 'provider', priority: 'normal' },
        dispatchAnim
      );
      expect(dispatchAnim).toHaveBeenLastCalledWith('REACT_HAPPY');

      // respond with happy mood
      applyBehaviorIntentToAnimation(
        { kind: 'respond', source: 'provider', priority: 'normal', moodHint: 'happy' },
        dispatchAnim
      );
      expect(dispatchAnim).toHaveBeenLastCalledWith('REACT_HAPPY');

      // respond with neutral/curious mood
      applyBehaviorIntentToAnimation(
        { kind: 'respond', source: 'provider', priority: 'normal', moodHint: 'curious' },
        dispatchAnim
      );
      expect(dispatchAnim).toHaveBeenLastCalledWith('SETTLE');

      // respond with confused mood
      applyBehaviorIntentToAnimation(
        { kind: 'respond', source: 'provider', priority: 'normal', moodHint: 'confused' },
        dispatchAnim
      );
      expect(dispatchAnim).toHaveBeenLastCalledWith('REACT_CONFUSED');

      // respond with sleepy mood
      applyBehaviorIntentToAnimation(
        { kind: 'respond', source: 'provider', priority: 'normal', moodHint: 'sleepy' },
        dispatchAnim
      );
      expect(dispatchAnim).toHaveBeenLastCalledWith('START_SLEEP');

      // wake
      applyBehaviorIntentToAnimation(
        { kind: 'wake', source: 'provider', priority: 'normal' },
        dispatchAnim
      );
      expect(dispatchAnim).toHaveBeenLastCalledWith('WAKE_UP');

      // idle / quiet
      applyBehaviorIntentToAnimation(
        { kind: 'idle', source: 'provider', priority: 'normal' },
        dispatchAnim
      );
      expect(dispatchAnim).toHaveBeenLastCalledWith('SETTLE');
    });
  });

  describe('processDialogueTurn', () => {
    it('processes user message and returns structured result with mapped BehaviorIntent and reply text', async () => {
      const provider = new MockAIProvider({ simulatedLatencyMs: 0 });

      const turn = await processDialogueTurn({
        aiProvider: provider,
        userText: 'Привет, Wisp!',
        characterMood: 'content',
        characterActivity: 'idle',
      });

      expect(turn.intent.kind).toBe('react_happy');
      expect(turn.replyText).toBeDefined();
      expect(turn.replyText).toContain('Wisp');
      expect(turn.userMessage.text).toBe('Привет, Wisp!');
      expect(turn.contextMessage).toBeDefined();
      expect(turn.contextMessage?.role).toBe('wisp');
      expect(turn.contextMessage?.text).toBe(turn.replyText);
    });

    it('processes sleep message and returns sleep BehaviorIntent', async () => {
      const provider = new MockAIProvider({ simulatedLatencyMs: 0 });

      const turn = await processDialogueTurn({
        aiProvider: provider,
        userText: 'Пора спать, спокойной ночи',
        characterMood: 'neutral',
        characterActivity: 'idle',
      });

      expect(turn.intent.kind).toBe('sleep');
      expect(turn.intent.moodHint).toBe('sleepy');
      expect(turn.replyText).toBeDefined();
    });

    it('processes fallback message for empty input', async () => {
      const provider = new MockAIProvider({ simulatedLatencyMs: 0 });

      const turn = await processDialogueTurn({
        aiProvider: provider,
        userText: '   ',
        characterMood: 'neutral',
        characterActivity: 'idle',
      });

      expect(turn.intent.kind).toBe('react_confused');
      expect(turn.intent.reason).toBe('empty_input');
    });

    it('maintains context history across turns', async () => {
      const provider = new MockAIProvider({ simulatedLatencyMs: 0 });

      const turn1 = await processDialogueTurn({
        aiProvider: provider,
        userText: 'Привет!',
        characterMood: 'content',
        characterActivity: 'idle',
      });

      const context = [
        { role: 'user' as const, text: 'Привет!', createdAt: turn1.userMessage.createdAt },
        turn1.contextMessage!,
      ];

      const turn2 = await processDialogueTurn({
        aiProvider: provider,
        userText: 'Как дела?',
        characterMood: 'content',
        characterActivity: 'idle',
        recentContext: context,
      });

      expect(turn2.intent.kind).toBe('respond');
      expect(turn2.replyText).toBeDefined();
    });
  });
});
