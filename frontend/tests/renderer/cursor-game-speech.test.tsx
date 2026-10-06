import { expect, it } from 'vitest';
import { SpeechProjection } from '../../src/renderer/speech-projection';
import { parseCursorGame } from '../../src/shared/cursor-game-validation';
import type { BrainStateDTO } from '../../src/shared/ipc-contracts';

function snapshot(): BrainStateDTO {
  return { streamId: 'stream', revision: 1, sampledAtMs: 500, autonomy: { quiet: false },
    dialogue: { conversationId: 'c', canSubmit: true, turn: { phase: 'idle' } },
    cursorGame: { runId: 'run', outcome: null, speech: { id: 'attempt', text: 'Wait!', startedAtMs: 0, expiresAtMs: 2000 } },
    character: { needs: { energy: 80, attention: 50, play: 80, comfort: 70, boredom: 50 }, synthesizedTone: 'neutral' },
    activity: null, motion: { phase: 'grounded', rootScreenPosition: { x: 400, y: 790 }, velocityPxPerSec: { x: 0, y: 0 }, positionAuthority: 'voluntary' },
    visualIntent: { episodeId: 'visual', episodeStartedAtMs: 0, kind: 'cursor_play', category: 'reaction', priority: 'normal',
      interrupt: 'yes', loop: 'bounded', emotionalTone: 'neutral' } };
}
it('dedupes speech and uses the remaining lifetime instead of replaying on revisions', () => {
  const p = new SpeechProjection(), s = snapshot();
  expect(p.accept(s)).toMatchObject({ text: 'Wait!', durationMs: 1500 });
  expect(p.accept({ ...s, revision: 2, sampledAtMs: 1000 })).toBeUndefined();
  expect(p.accept({ ...s, cursorGame: null })).toBeNull();
  expect(p.accept(s)).toBeUndefined();
});
it('lets new game speech replace a shown dialogue without replaying the old reply on expiry', () => {
  const p = new SpeechProjection(), s = snapshot();
  const reply: BrainStateDTO = { ...s, cursorGame: null, dialogue: { ...s.dialogue,
    turn: { phase: 'completed', requestId: 'r', replyText: 'Hello', outcome: { kind: 'success' } } } };
  expect(p.accept(reply)?.text).toBe('Hello');
  expect(p.accept({ ...reply, cursorGame: s.cursorGame })?.text).toBe('Wait!');
  expect(p.accept(reply)).toBeNull(); expect(p.accept(reply)).toBeUndefined();
});
it('validates exact projection shape, IDs, text and lifetime', () => {
  const value = snapshot().cursorGame!;
  expect(parseCursorGame(value, 500)).toEqual(value); expect(parseCursorGame(null, 500)).toBeNull();
  for (const bad of [undefined, {}, { ...value, runId: '' }, { ...value, outcome: 'win' }, { ...value, extra: true },
    { ...value, speech: { ...value.speech, text: 'x'.repeat(241) } },
    { ...value, speech: { ...value.speech, expiresAtMs: 0 } },
    { ...value, speech: { ...value.speech, startedAtMs: NaN } },
    { ...value, speech: { ...value.speech, expiresAtMs: 500 } }]) expect(() => parseCursorGame(bad, 500)).toThrow();
});
