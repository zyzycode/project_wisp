import { expect, it, vi } from 'vitest';
import { DialogueCommandClient } from '../../src/renderer/dialogue-command-client';
import type { BrainStateDTO, DialogueCommandReceiptDTO } from '../../src/shared/ipc-contracts';
function snapshot(revision: number, streamId = 'stream'): BrainStateDTO {
  return { streamId, revision, sampledAtMs: 0, character: { needs: { energy: 50, comfort: 50, play: 50, attention: 50, boredom: 50 }, synthesizedTone: 'neutral' },
    activity: null, motion: { phase: 'grounded', rootScreenPosition: { x: 100, y: 100 }, velocityPxPerSec: { x: 0, y: 0 }, positionAuthority: 'voluntary' },
    visualIntent: { episodeId: 'e', episodeStartedAtMs: 0, kind: 'idle_blink', category: 'idle', priority: 'low', interrupt: 'yes', loop: 'until_replaced', emotionalTone: 'neutral' },
    dialogue: { conversationId: 'c', canSubmit: true, turn: { phase: 'idle' } } };
}
function fixture() {
  let settle!: (receipt: DialogueCommandReceiptDTO) => void;
  const postDialogueCommand = vi.fn(() => new Promise<DialogueCommandReceiptDTO>(resolve => { settle = resolve; }));
  const client = new DialogueCommandClient({ postDialogueCommand }); client.accept(snapshot(1));
  return { client, postDialogueCommand, settle: (r: DialogueCommandReceiptDTO) => settle(r) };
}
it.each([true, false])('handles snapshot and receipt in either order: snapshot first=%s', async first => {
  const f = fixture(), sending = f.client.send('Привет'); expect(await f.client.send('Duplicate')).toBe(false);
  const thinking = { ...snapshot(2), dialogue: { conversationId: 'c', canSubmit: false, turn: { phase: 'thinking' as const, requestId: 'r' } } };
  if (first) f.client.accept(thinking);
  f.settle({ status: 'accepted', conversationId: 'c' }); expect(await sending).toBe(true);
  if (!first) f.client.accept(thinking);
  expect(f.client.getState().canSubmit).toBe(false);
  f.client.accept(snapshot(1)); expect(f.client.getState().canSubmit).toBe(false);
  f.client.accept({ ...snapshot(3), dialogue: { conversationId: 'c', canSubmit: true, turn: { phase: 'completed', requestId: 'r', replyText: 'Ответ', outcome: { kind: 'success' } } } });
  expect(f.client.getState().canSubmit).toBe(true); expect(f.postDialogueCommand).toHaveBeenCalledTimes(1);
});
it('ignores receipts from an old stream', async () => {
  const f = fixture(), sending = f.client.send('old'); f.client.accept(snapshot(1, 'next'));
  f.settle({ status: 'accepted', conversationId: 'c' }); expect(await sending).toBe(false); expect(f.client.getState()).toEqual({ canSubmit: true, error: null });
});
it('reports rejection and transport failure without retrying', async () => {
  const f = fixture(), sending = f.client.send('text'); f.settle({ status: 'rejected', reason: 'busy' }); expect(await sending).toBe(false);
  expect(f.client.getState().error).not.toBeNull(); expect(f.postDialogueCommand).toHaveBeenCalledTimes(1);
  const postDialogueCommand = vi.fn(async () => { throw new Error('secret'); }); const client = new DialogueCommandClient({ postDialogueCommand }); client.accept(snapshot(1));
  expect(await client.send('text')).toBe(false); expect(client.getState().canSubmit).toBe(true); expect(client.getState().error).not.toContain('secret');
  expect(postDialogueCommand).toHaveBeenCalledTimes(1);
});

