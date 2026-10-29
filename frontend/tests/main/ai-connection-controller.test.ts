import { describe, expect, it, vi } from 'vitest';
import type { ILocalAIBackend, IUserAIKeyStore, LocalAIBackendStartResult, UserAIKeyStoreResult } from '../../src/application/ports/ai-connection.interface';
import { AIConnectionController } from '../../src/main/ai-connection-controller';
import { registerAIConnectionIpc } from '../../src/main/ai-connection-ipc-registration';

function fixture(externalUrl?: string) {
  const store = {
    isAvailable: vi.fn(async () => true), hasSavedKey: vi.fn(async () => ({ ok: true, value: true } as const)),
    load: vi.fn(async () => ({ ok: true, value: 'synthetic-secret' } as const)),
    save: vi.fn<IUserAIKeyStore['save']>(async () => ({ ok: true, value: undefined })),
    remove: vi.fn<IUserAIKeyStore['remove']>(async () => ({ ok: true, value: undefined })),
  } satisfies IUserAIKeyStore;
  const backend = { start: vi.fn<ILocalAIBackend['start']>(async () => ({ ok: true, port: 3456 })), stop: vi.fn(async () => undefined) };
  const scheduleRestart = vi.fn();
  const controller = new AIConnectionController({ externalUrl, store, backend, scheduleRestart, ledgerPath: '/user-data/ledger', createSessionToken: () => 'a'.repeat(64) });
  return { controller, store, backend, scheduleRestart };
}
describe('Main personal AI connection composition', () => {
  it('uses an operator deployment without accessing personal storage or starting a child', async () => {
    const f = fixture('https://external.example');
    expect(await f.controller.initialize()).toEqual({ backendUrl: 'https://external.example' });
    expect(f.store.isAvailable).not.toHaveBeenCalled(); expect(f.store.load).not.toHaveBeenCalled(); expect(f.backend.start).not.toHaveBeenCalled();
    expect(await f.controller.configure({ streamId: 's', kind: 'save', apiKey: 'synthetic-key' })).toEqual({ ok: false, code: 'externally_managed' });
  });
  it('selects the managed route once and never projects keys or tokens into status', async () => {
    const f = fixture();
    expect(await f.controller.initialize()).toEqual({ backendUrl: 'http://127.0.0.1:3456', sessionToken: 'a'.repeat(64) });
    expect(f.controller.read()).toEqual({ mode: 'ready', hasSavedKey: true, secureStorageAvailable: true, failure: null });
    f.controller.backendUnavailable();
    expect(f.controller.read().mode).toBe('unavailable'); expect(f.backend.start).toHaveBeenCalledOnce();
  });
  it('keeps locked-storage presence metadata and allows deleting without decryption', async () => {
    const f = fixture(); f.store.isAvailable.mockResolvedValue(false);
    expect(await f.controller.initialize()).toEqual({});
    expect(f.controller.read()).toEqual({ mode: 'unavailable', hasSavedKey: true, secureStorageAvailable: false, failure: 'secure_storage_unavailable' });
    expect(f.store.load).not.toHaveBeenCalled();
    expect(await f.controller.configure({ streamId: 's', kind: 'remove' })).toEqual({ ok: true, restartRequired: true });
    expect(f.scheduleRestart).toHaveBeenCalledOnce();
  });
  it('never selects a child that exits while startup readiness is being delivered', async () => {
    const f = fixture(); let ready: ((result: LocalAIBackendStartResult) => void) | undefined;
    f.backend.start.mockImplementation(() => new Promise(resolve => { ready = resolve; }));
    const initializing = f.controller.initialize();
    for (let turn = 0; turn < 5; turn++) await Promise.resolve();
    ready?.({ ok: true, port: 3456 }); f.controller.backendUnavailable();
    expect(await initializing).toEqual({}); expect(f.controller.read()).toMatchObject({ mode: 'unavailable', failure: 'startup_failed' });
  });
  it('admits only one mutation and restarts only after the storage commit', async () => {
    const f = fixture(); let complete: ((value: UserAIKeyStoreResult<void>) => void) | undefined;
    f.store.save.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    const command = { streamId: 's', kind: 'save', apiKey: 'synthetic-key' } as const;
    const first = f.controller.configure(command);
    expect(await f.controller.configure(command)).toEqual({ ok: false, code: 'busy' });
    expect(f.scheduleRestart).not.toHaveBeenCalled(); complete?.({ ok: true, value: undefined });
    expect(await first).toEqual({ ok: true, restartRequired: true });
    expect(await f.controller.configure(command)).toEqual({ ok: false, code: 'busy' });
    expect(f.scheduleRestart).toHaveBeenCalledOnce();
  });
  it('does not restart on failed writes and never returns exception details', async () => {
    const f = fixture(); f.store.save.mockRejectedValue(new Error('secret-key path detail'));
    expect(await f.controller.configure({ streamId: 's', kind: 'save', apiKey: 'synthetic-key' })).toEqual({ ok: false, code: 'storage_error' });
    expect(f.scheduleRestart).not.toHaveBeenCalled();
    await f.controller.stop(); expect(f.backend.stop).toHaveBeenCalledOnce();
    expect(await f.controller.configure({ streamId: 's', kind: 'remove' })).toEqual({ ok: false, code: 'stale' });
  });
});
describe('AI connection IPC', () => {
  function setup() {
    const f = fixture(); const sender = {}; let stream = 's';
    const handlers = new Map<string, (event: { sender: object }, ...args: unknown[]) => Promise<unknown>>();
    const unregister = registerAIConnectionIpc({ register: (key, handler) => { handlers.set(key, handler); }, remove: key => { handlers.delete(key); },
      getSender: () => sender, getStream: () => stream, controller: f.controller });
    const call = (operation: string, value: unknown, from = sender) => handlers.get(`wisp:ai-connection-${operation}`)!({ sender: from }, value);
    return { ...f, handlers, unregister, call, replaceStream: () => { stream = 'new'; } };
  }
  it('rejects untrusted before examining payload and stale/malformed before storage', async () => {
    const f = setup();
    await expect(f.call('configure', { get apiKey() { throw new Error('must not be accessed'); } }, {})).rejects.toThrow('Untrusted');
    expect(await f.call('configure', { streamId: 'old', kind: 'remove' })).toEqual({ ok: false, code: 'stale' });
    expect(await f.call('configure', { streamId: 's', kind: 'save', apiKey: 'synthetic-secret', url: 'bad' })).toEqual({ ok: false, code: 'invalid_input' });
    expect(f.store.save).not.toHaveBeenCalled(); expect(f.store.remove).not.toHaveBeenCalled();
  });
  it('does not apply a late receipt to a replacement stream but still restarts an admitted committed write', async () => {
    const f = setup(); let complete: ((value: UserAIKeyStoreResult<void>) => void) | undefined;
    f.store.save.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    const pending = f.call('configure', { streamId: 's', kind: 'save', apiKey: 'synthetic-key' });
    f.replaceStream(); complete?.({ ok: true, value: undefined });
    expect(await pending).toEqual({ ok: false, code: 'stale' }); expect(f.scheduleRestart).toHaveBeenCalledOnce();
    await expect(f.call('read', { streamId: 's' })).rejects.toThrow('Stale');
    f.unregister(); expect(f.handlers.size).toBe(0);
  });
});
