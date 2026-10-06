import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { ChatInput } from '../../src/renderer/components/Chat/ChatInput';
import { SpeechProjection } from '../../src/renderer/speech-projection';
import type { BrainStateDTO } from '../../src/shared/ipc-contracts';

it('renders the admission notice as an input status with submission disabled', () => {
  const markup = renderToStaticMarkup(<ChatInput isOpen canSubmit={false} onSendMessage={vi.fn()} onClose={vi.fn()} submissionMessage="Лимит исчерпан." />);
  expect(markup).toContain('<div role="status">Лимит исчерпан.</div>');
  expect(markup).toMatch(/class="chat-send-btn" disabled=""/u);
  expect(markup).not.toContain('speech-bubble');
});

it('never converts policy notice changes into character speech or replays the completed reply', () => {
  const snapshot: BrainStateDTO = {
    streamId: 's', revision: 1, sampledAtMs: 0, cursorGame: null, autonomy: { quiet: false },
    character: { needs: { energy: 50, attention: 50, play: 50, comfort: 50, boredom: 50 }, synthesizedTone: 'neutral' },
    activity: null, motion: { phase: 'grounded', rootScreenPosition: { x: 0, y: 0 }, velocityPxPerSec: { x: 0, y: 0 }, positionAuthority: 'voluntary' },
    visualIntent: { episodeId: 'e', episodeStartedAtMs: 0, kind: 'idle_blink', category: 'idle', priority: 'low', interrupt: 'yes', loop: 'until_replaced', emotionalTone: 'neutral' },
    dialogue: { conversationId: 'c', canSubmit: false, submissionMessage: 'Лимит исчерпан.',
      turn: { phase: 'completed', requestId: 'r', replyText: 'Ответ персонажа', outcome: { kind: 'success' } } },
  };
  const projection = new SpeechProjection();
  expect(projection.accept(snapshot)?.text).toBe('Ответ персонажа');
  expect(projection.accept({ ...snapshot, revision: 2, dialogue: { ...snapshot.dialogue, submissionMessage: 'Подожди.' } })).toBeUndefined();
});
