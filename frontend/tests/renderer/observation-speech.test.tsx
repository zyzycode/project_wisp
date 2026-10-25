import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ObservationSettings, OBSERVATION_DISCLOSURE } from '../../src/renderer/components/Interaction/ObservationSettings';
import { SpeechProjection } from '../../src/renderer/speech-projection';
import { parseBrainStateDTO } from '../../src/shared/brain-body-ipc-validation';
import type { BrainStateDTO } from '../../src/shared/ipc-contracts';
const speech = { id: 'obs', text: 'Пауза?', startedAtMs: 100, expiresAtMs: 2100 };
function snapshot(): BrainStateDTO { return { streamId: 's', revision: 1, sampledAtMs: 100, observationSpeech: speech, cursorGame: null,
  autonomy: { quiet: false }, dialogue: { conversationId: 'c', canSubmit: true, turn: { phase: 'idle' } }, character: { needs: { energy: 50, attention: 50, play: 50, comfort: 50, boredom: 50 }, synthesizedTone: 'neutral' }, activity: null,
  motion: { phase: 'grounded', rootScreenPosition: { x: 0, y: 0 }, velocityPxPerSec: { x: 0, y: 0 }, positionAuthority: 'voluntary' },
  visualIntent: { episodeId: 'e', episodeSequence: 1, episodeStartedAtMs: 0, kind: 'idle_blink', category: 'idle', priority: 'low', interrupt: 'yes', loop: 'until_replaced', emotionalTone: 'neutral' } }; }
it('renders provider+title disclosure and RAM-reset limitation before opt-in without invoking observation', () => {
  const bridge = vi.fn(); const markup = renderToStaticMarkup(<ObservationSettings bridge={bridge} streamId="s" open />);
  expect(markup).toContain(OBSERVATION_DISCLOSURE); expect(markup).toContain('после перезапуска'); expect(markup).toContain('согласие очищаются'); expect(bridge).not.toHaveBeenCalled();
});
it('validates observation projection atomically, supports absent/null and rejects malformed lifetime', () => {
  const s = snapshot(); expect(parseBrainStateDTO(s).observationSpeech).toEqual(speech);
  expect(parseBrainStateDTO({ ...s, observationSpeech: null }).observationSpeech).toBeNull(); const { observationSpeech: _, ...legacy } = s; expect(parseBrainStateDTO(legacy).observationSpeech).toBeUndefined();
  for (const patch of [{ expiresAtMs: 2101 }, { text: 'x'.repeat(241) }, { id: ' ' }, { title: 'leak' }, { startedAtMs: -1 }]) expect(() => parseBrainStateDTO({ ...s, observationSpeech: { ...speech, ...patch } })).toThrow();
});
it('dedupes observation and removes it on null without resurrecting dialogue', () => {
  const p = new SpeechProjection(), s = snapshot(); expect(p.accept(s)?.text).toBe('Пауза?'); expect(p.accept(s)).toBeUndefined();
  expect(p.accept({ ...s, observationSpeech: null })).toBeNull(); expect(p.accept({ ...s, observationSpeech: null })).toBeUndefined();
});
it('dialogue then initiative/game preempt observation and the consumed line is never replayed', () => {
  const p = new SpeechProjection(), s = snapshot(); p.accept(s);
  expect(p.accept({ ...s, dialogue: { ...s.dialogue, canSubmit: false, turn: { phase: 'thinking', requestId: 'user' } } })).toBeNull();
  expect(p.accept({ ...s, initiativeSpeech: { ...speech, id: 'initiative', text: 'Higher' } })?.text).toBe('Higher');
  expect(p.accept({ ...s, observationSpeech: null })).toBeNull(); expect(p.accept(s)).toBeUndefined();
  const game = { runId: 'game', outcome: 'caught' as const, speech: { ...speech, id: 'game', text: 'Game' } };
  expect(new SpeechProjection().accept({ ...s, cursorGame: game })?.text).toBe('Game');
});

it('shows a local quiet-support ACK as ordinary dialogue exactly once without memory controls or fallback text', () => {
  const p = new SpeechProjection(), s = snapshot();
  const local: BrainStateDTO = { ...s, observationSpeech: null, dialogue: { conversationId: 'c', canSubmit: true,
    turn: { phase: 'completed', requestId: 'support', replyText: 'Поняла. Я рядом.', outcome: { kind: 'local', reason: 'quiet_support' } } } };
  expect(parseBrainStateDTO(local).dialogue).toEqual(local.dialogue);
  expect(p.accept(local)?.text).toBe('Поняла. Я рядом.'); expect(p.accept(local)).toBeUndefined();
  expect(p.accept({ ...local, dialogue: { ...local.dialogue, turn: { phase: 'idle' } } })).toBeNull();
});
