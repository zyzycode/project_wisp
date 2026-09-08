import { expect, it } from 'vitest';
import { CursorGamePresentation } from '../../src/application/services/cursor-game-presentation';

it('emits one attempt and one outcome per run, with expiry and no terminal replay', () => {
  let now = 0; const p = new CursorGamePresentation(() => now);
  p.phase('run', 'attempt', null); expect(p.get()?.speech?.expiresAtMs).toBe(2000);
  now = 1000; p.phase('run', 'attempt', null); expect(p.get()?.speech?.expiresAtMs).toBe(2000);
  p.phase('run', 'reaction', 'caught'); expect(p.get()?.speech?.text).toBe('Поймала!');
  now = 2999; expect(p.tick()).toBe(false); now = 3000; expect(p.tick()).toBe(true);
  p.terminal('run', 'caught'); expect(p.get()).toBeNull();
});
it('uses ru/en fallback catalog and cancels silently', () => {
  const p = new CursorGamePresentation(() => 0, () => 'en');
  p.phase('run', 'attempt', null); expect(p.get()?.speech?.text).toBe('Wait, I almost caught you!');
  p.phase('run', 'reaction', 'lost_target'); expect(p.get()?.speech?.text).toBe('Where did you go?');
  p.terminal('run', 'cancelled'); expect(p.get()).toBeNull();
});
it('hides game speech for thinking and five seconds after dialogue, without queued lines', () => {
  let now = 0; const p = new CursorGamePresentation(() => now);
  p.observeDialogue({ conversationId: 'c', canSubmit: true, turn: { phase: 'idle' } });
  p.phase('run', 'attempt', null);
  p.observeDialogue({ conversationId: 'c', canSubmit: false, turn: { phase: 'thinking', requestId: 'r' } });
  expect(p.get()?.speech).toBeNull();
  p.phase('run', 'reaction', 'caught'); expect(p.get()?.speech).toBeNull();
  now = 1000; const completed = { conversationId: 'c', canSubmit: true,
    turn: { phase: 'completed' as const, requestId: 'r', replyText: 'Hello', outcome: { kind: 'success' as const } } };
  p.observeDialogue(completed); now = 5999; p.phase('run2', 'attempt', null); expect(p.get()?.speech).toBeNull();
  p.observeDialogue(completed); now = 6000; p.phase('run2', 'attempt', null); expect(p.get()?.speech).toBeNull();
  p.phase('run2', 'reaction', 'missed'); expect(p.get()?.speech?.text).toBe('В этот раз ты быстрее.');
  p.reset(); p.observeDialogue({ conversationId: 'new', canSubmit: true, turn: { phase: 'idle' } });
  p.phase('run3', 'attempt', null); expect(p.get()?.speech).not.toBeNull();
});
it('expiry from an older run never clears replacement speech', () => {
  let now = 0; const p = new CursorGamePresentation(() => now);
  p.phase('old', 'attempt', null); now = 1500; p.phase('new', 'attempt', null);
  now = 2000; p.tick(); expect(p.get()?.runId).toBe('new');
});
