import { expect, it, vi } from 'vitest';
import { InitiativeSessionControls } from '../../src/application/services/initiative-session-controls';
import { registerInitiativeIpc } from '../../src/main/initiative-ipc-registration';
import { parseInitiativeStatus, parseWindowHelpStatus } from '../../src/shared/initiative-status-validation';
it('bounds sender, stream, profile and decline shape without renderer completion authority', async () => {
  const handlers = new Map<string, (event: { readonly sender: object }, ...args: unknown[]) => Promise<unknown>>();
  const sender = {}, decline = vi.fn(async () => ({ ok: true as const }));
  const controls = new InitiativeSessionControls({ streamId: () => 's', revoke: vi.fn(), conditions: () => ({
    capability: true, memory: true, quiet: false, sleeping: false, away: false, busy: false }) });
  const dispose = registerInitiativeIpc({ register: (channel, handler) => handlers.set(channel, handler),
    remove: channel => handlers.delete(channel), getSender: () => sender, controls, help: () => ({ decline }) });
  const invoke = (channel: string, value: unknown, origin = sender) => handlers.get(channel)!({ sender: origin }, value);
  await expect(invoke('wisp:initiative-read', { streamId: 's' }, {})).rejects.toThrow('Untrusted');
  expect(await invoke('wisp:initiative-consent', { streamId: 'old', profileGeneration: 0, enabled: true })).toEqual({ ok: false, code: 'stale' });
  expect(await invoke('wisp:initiative-consent', { streamId: 's', profileGeneration: 0, enabled: true, probe: true })).toEqual({ ok: false, code: 'invalid_input' });
  expect(await invoke('wisp:initiative-consent', { streamId: 's', profileGeneration: 0, enabled: true })).toMatchObject({ ok: true, status: { enabled: true, requestsSent: 0 } });
  expect(await invoke('wisp:window-help-decline', { streamId: 's', requestId: 'r', outcome: 'fulfilled' })).toEqual({ ok: false, code: 'invalid_input' });
  expect(decline).not.toHaveBeenCalled(); dispose(); expect(handlers.size).toBe(0);
});
it('validates readonly status and bounded geometry while rejecting private targets', () => {
  expect(() => parseInitiativeStatus({ profileGeneration: -1 })).toThrow();
  const status = { phase: 'waiting', requestId: 'r', expiresAtMs: 60000,
    target: { region: 'upper_left', left: .1, top: .1, width: .3, height: .3 } };
  expect(parseWindowHelpStatus(status)).toEqual(status);
  expect(() => parseWindowHelpStatus({ ...status, target: { ...status.target, surfaceId: 'private' } })).toThrow();
  expect(() => parseWindowHelpStatus({ ...status, target: { ...status.target, width: 1 } })).toThrow();
});
