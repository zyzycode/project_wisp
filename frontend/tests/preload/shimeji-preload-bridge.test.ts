import { describe, expect, it, vi } from 'vitest';
import type { BrainStateDTO, WispApiBridge } from '../../src/shared/ipc-contracts';

const electronMocks = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
}));

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: electronMocks.exposeInMainWorld },
  ipcRenderer: {
    invoke: electronMocks.invoke,
    on: electronMocks.on,
    removeListener: electronMocks.removeListener,
  },
}));

import '../../src/preload/index';

function exposedApi(): WispApiBridge {
  const call = electronMocks.exposeInMainWorld.mock.calls[0];
  if (call === undefined) throw new Error('Preload bridge was not exposed');
  return call[1] as WispApiBridge;
}

describe('Preload: Shimeji bridge', () => {
  it('validates explicit summary preview, confirm and deletion in both directions', async () => {
    const api = exposedApi(); electronMocks.invoke.mockReset();
    const value = { previewId: 'p', expiresAt: 120000, pairs: Array.from({ length: 4 }, () => ({ userText: 'u', assistantText: 'a' })) };
    electronMocks.invoke.mockResolvedValueOnce({ ok: true, value });
    await expect(api.summary!.preview({ streamId: 's' })).resolves.toEqual({ ok: true, value });
    expect(electronMocks.invoke).toHaveBeenLastCalledWith('wisp:summary-preview', { streamId: 's' });
    electronMocks.invoke.mockResolvedValueOnce({ ok: true, value: 'summary' });
    await expect(api.summary!.confirm({ streamId: 's', commandId: 'c', previewId: 'p' })).resolves.toEqual({ ok: true, value: 'summary' });
    await expect(api.summary!.confirm({ streamId: 's', commandId: '', previewId: 'p' })).rejects.toThrow();
    expect(electronMocks.invoke).toHaveBeenCalledTimes(2);
    electronMocks.invoke.mockResolvedValueOnce({ ok: true, value: null });
    await expect(api.summary!.deleteSummary({ streamId: 's' })).resolves.toEqual({ ok: true, value: null });
    electronMocks.invoke.mockResolvedValueOnce({ ok: false, code: 'private/path' });
    await expect(api.summary!.preview({ streamId: 's' })).rejects.toThrow(); electronMocks.invoke.mockReset();
  });

  it('validates card commands and pages across the typed bridge', async () => {
    const api = exposedApi(); electronMocks.invoke.mockReset();
    const command = { streamId: 's', sequence: 1, commandId: 'c', generation: 0, itemId: 'i', expectedRevision: 1, kind: 'delete' } as const;
    electronMocks.invoke.mockResolvedValueOnce({ ok: false, generation: 0, code: 'unavailable' });
    await expect(api.mutateMemoryCard(command)).resolves.toMatchObject({ ok: false });
    expect(electronMocks.invoke).toHaveBeenLastCalledWith('wisp:mutate-memory-card', command);
    await expect(api.mutateMemoryCard({ ...command, expectedRevision: 0 })).rejects.toThrow();
    expect(electronMocks.invoke).toHaveBeenCalledTimes(1);
    electronMocks.invoke.mockResolvedValueOnce({ ok: true, generation: 0, items: [], nextCursor: null });
    await expect(api.listMemoryCards({ streamId: 's', cursor: null, limit: 20 })).resolves.toMatchObject({ items: [] });
    electronMocks.invoke.mockResolvedValueOnce({ ok: true, generation: 0, items: [], nextCursor: null, secret: true });
    await expect(api.listMemoryCards({ streamId: 's', cursor: null, limit: 20 })).rejects.toThrow();
    electronMocks.invoke.mockReset();
  });
  it('exposes typed memory status/reset with validation in both directions', async () => {
    const api = exposedApi(); electronMocks.invoke.mockReset();
    electronMocks.invoke.mockResolvedValueOnce({ mode: 'persistent', characterRestore: 'restored' });
    expect(await api.getMemoryStatus()).toEqual({ mode: 'persistent', characterRestore: 'restored' });
    expect(electronMocks.invoke).toHaveBeenCalledExactlyOnceWith('wisp:get-memory-status');
    electronMocks.invoke.mockResolvedValueOnce({ requestId: 'r', status: 'cleared' });
    expect(await api.clearMemory({ streamId: 's', requestId: 'r', sequence: 1 })).toEqual({ requestId: 'r', status: 'cleared' });
    await expect(api.clearMemory({ streamId: 's', requestId: 'r', sequence: 0 })).rejects.toThrow();
    expect(electronMocks.invoke).toHaveBeenCalledTimes(2);
    electronMocks.invoke.mockResolvedValueOnce({ mode: 'volatile', reason: 'private path' });
    await expect(api.getMemoryStatus()).rejects.toThrow(); electronMocks.invoke.mockReset();
  });
  it('validates both directions of the dialogue command channel', async () => {
    const api = exposedApi(); electronMocks.invoke.mockClear();
    electronMocks.invoke.mockResolvedValueOnce({ status: 'accepted', conversationId: 'c' });
    await expect(api.postDialogueCommand({ type: 'send', text: ' Привет ', streamId: 's', conversationId: 'c', sequence: 1 }))
      .resolves.toEqual({ status: 'accepted', conversationId: 'c' });
    expect(electronMocks.invoke).toHaveBeenCalledExactlyOnceWith('wisp:dialogue-command', { type: 'send', text: 'Привет', streamId: 's', conversationId: 'c', sequence: 1 });
    await expect(api.postDialogueCommand({ type: 'send', text: '', streamId: 's', conversationId: 'c', sequence: 2 })).rejects.toThrow();
    expect(electronMocks.invoke).toHaveBeenCalledTimes(1);
    electronMocks.invoke.mockResolvedValueOnce({ status: 'accepted', conversationId: 'c', secret: true });
    await expect(api.postDialogueCommand({ type: 'reset', streamId: 's', conversationId: 'c', sequence: 2 })).rejects.toThrow();
    electronMocks.invoke.mockReset();
  });
  it('uses exact Brain/Body channels, validates snapshots, and removes the exact listener', async () => {
    const api = exposedApi();
    const listener = vi.fn();

    const unsubscribe = api.onBrainState(listener);
    await api.setAutonomyEnabled?.({ enabled: false });
    await api.requestSleepWake({ action: 'sleep' });
    await api.requestSleepWake({ action: 'wake' });
    const bodyEvent = {
      streamId: 'stream-1', sequence: 1, basedOnRevision: 1, observedAtMs: 20,
      type: 'interaction' as const, interaction: 'click' as const,
    };
    await api.postBodyEvent(bodyEvent);

    const brainState: BrainStateDTO = {
      autonomy: { quiet: false }, cursorGame: null,
    dialogue: { conversationId: 'conversation-1', canSubmit: true, turn: { phase: 'idle' } },
      streamId: 'stream-1', revision: 1, sampledAtMs: 10,
      character: {
        needs: { energy: 80, attention: 30, play: 40, comfort: 50, boredom: 10 },
        synthesizedTone: 'neutral',
      },
      activity: null,
      motion: {
        phase: 'grounded', rootScreenPosition: { x: 1, y: 2 },
        velocityPxPerSec: { x: 0, y: 0 }, positionAuthority: 'voluntary',
      },
      visualIntent: {
        episodeId: 'episode-1', episodeSequence: 1, episodeStartedAtMs: 5, kind: 'idle_blink',
        category: 'idle', priority: 'low', interrupt: 'yes', loop: 'until_replaced',
        emotionalTone: 'neutral',
      },
    };
    const registeredListener = electronMocks.on.mock.calls.find(
      ([channel]: readonly unknown[]) => channel === 'wisp:brain-state'
    )?.[1] as ((event: unknown, payload: unknown) => void) | undefined;
    registeredListener?.({}, brainState);
    registeredListener?.({}, { ...brainState, extra: true });
    unsubscribe();
    registeredListener?.({}, { ...brainState, revision: 2 });
    const lateListener = vi.fn();
    const unsubscribeLate = api.onBrainState(lateListener);
    unsubscribeLate();

    expect(electronMocks.invoke).toHaveBeenNthCalledWith(1, 'wisp:set-autonomy-enabled', { enabled: false });
    expect(electronMocks.invoke).toHaveBeenNthCalledWith(2, 'wisp:request-sleep-wake', { action: 'sleep' });
    expect(electronMocks.invoke).toHaveBeenNthCalledWith(3, 'wisp:request-sleep-wake', { action: 'wake' });
    expect(electronMocks.invoke).toHaveBeenNthCalledWith(
      4,
      'wisp:body-event',
      bodyEvent
    );
    expect(api).not.toHaveProperty('beginPetDrag');
    expect(api).not.toHaveProperty('movePetDrag');
    expect(api).not.toHaveProperty('releasePetDrag');
    expect(api).not.toHaveProperty('interactWithCharacter');
    expect(api).not.toHaveProperty('setMenuExpanded');
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(brainState);
    expect(lateListener).toHaveBeenCalledWith({ ...brainState, revision: 2 });
    expect(electronMocks.on).toHaveBeenCalledWith('wisp:brain-state', registeredListener);
  });
});

it('validates beverage consent, outbound preference shapes and per-turn opt-in through Preload', async () => {
  const api = exposedApi(); electronMocks.invoke.mockReset();
  const command = { streamId: 's', sequence: 1, generation: 0, commandId: 'c', kind: 'save_hypothesis', itemId: 'i', expected: null, offerId: 'o', consented: true } as const;
  electronMocks.invoke.mockResolvedValueOnce({ ok: false, generation: 0, code: 'unavailable' });
  await expect(api.beveragePreference!.mutate(command)).resolves.toMatchObject({ ok: false });
  expect(electronMocks.invoke).toHaveBeenLastCalledWith('wisp:mutate-beverage', command);
  electronMocks.invoke.mockResolvedValueOnce({ ok: true, generation: 0, value: null, providerSecret: true });
  await expect(api.beveragePreference!.read({ streamId: 's' })).rejects.toThrow();
  electronMocks.invoke.mockResolvedValueOnce({ status: 'accepted', conversationId: 'c' });
  await api.postDialogueCommand({ type: 'send', streamId: 's', conversationId: 'c', sequence: 1, text: 'чай', requestBeverageProposal: true });
  expect(electronMocks.invoke).toHaveBeenLastCalledWith('wisp:dialogue-command', expect.objectContaining({ requestBeverageProposal: true }));
  electronMocks.invoke.mockReset();
});
