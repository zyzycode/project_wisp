import { expect, it } from 'vitest';
import { SpeechProjection } from '../../src/renderer/speech-projection';
import { parseBrainStateDTO } from '../../src/shared/brain-body-ipc-validation';
import { parseInitiativeSpeech } from '../../src/shared/initiative-speech-validation';
import type { BrainStateDTO } from '../../src/shared/ipc-contracts';
const speech = { id: 'ai1', text: 'Поговорим?', startedAtMs: 100, expiresAtMs: 2100 };
function snapshot(): BrainStateDTO {
  return { streamId: 's', revision: 1, sampledAtMs: 100, initiativeSpeech: speech, cursorGame: null, autonomy: { quiet: false }, dialogue: { conversationId: 'c', canSubmit: true, turn: { phase: 'idle' } },
    character: { needs: { energy: 50, attention: 50, play: 50, comfort: 50, boredom: 50 }, synthesizedTone: 'neutral' }, activity: null,
    motion: { phase: 'grounded', rootScreenPosition: { x: 0, y: 0 }, velocityPxPerSec: { x: 0, y: 0 }, positionAuthority: 'voluntary' },
    visualIntent: { episodeId: 'e', episodeStartedAtMs: 0, kind: 'idle_blink', category: 'idle', priority: 'low', interrupt: 'yes', loop: 'until_replaced', emotionalTone: 'neutral' } };
}
it('validates the additive optional/null/object projection with bounded text/time/identity', () => {
  const s = snapshot(); expect(parseBrainStateDTO(s).initiativeSpeech).toEqual(speech);
  expect(parseBrainStateDTO({ ...s, initiativeSpeech: null }).initiativeSpeech).toBeNull();
  for (const bad of [{ ...speech, text: 'x'.repeat(241) }, { ...speech, id: '' }, { ...speech, expiresAtMs: 2101 }, { ...speech, startedAtMs: 101 }, { ...speech, expiresAtMs: 100 }, { ...speech, extra: true }]) expect(() => parseInitiativeSpeech(bad, 100)).toThrow();
});
it('dedupes initiative and removes it on expiry without replaying the previous dialogue', () => {
  const p = new SpeechProjection(), s = snapshot();
  const dialogue: BrainStateDTO = { ...s, initiativeSpeech: null, dialogue: { ...s.dialogue, turn: { phase: 'completed', requestId: 'old', replyText: 'Ответ', outcome: { kind: 'success' } } } };
  expect(p.accept(dialogue)?.text).toBe('Ответ');
  expect(p.accept({ ...dialogue, revision: 2, initiativeSpeech: speech })?.text).toBe('Поговорим?');
  expect(p.accept({ ...dialogue, revision: 3, initiativeSpeech: speech })).toBeUndefined();
  expect(p.accept({ ...dialogue, revision: 4 })).toBeNull(); expect(p.accept({ ...dialogue, revision: 5 })).toBeUndefined();
});
it('prioritizes current user dialogue and immediate game speech over initiatives', () => {
  const s = snapshot(), p = new SpeechProjection();
  expect(p.accept({ ...s, dialogue: { ...s.dialogue, turn: { phase: 'thinking', requestId: 'r' }, canSubmit: false } })).toBeNull();
  const game: BrainStateDTO = { ...s, cursorGame: { runId: 'game', outcome: 'caught', speech: { ...speech, id: 'game', text: 'Поймала!' } } };
  expect(p.accept(game)?.text).toBe('Поймала!'); expect(p.accept(game)).toBeUndefined();
});
