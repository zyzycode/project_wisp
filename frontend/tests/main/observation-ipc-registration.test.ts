import { expect, it, vi } from 'vitest';
import { registerObservationIpc } from '../../src/main/observation-ipc-registration';
import { observationFixture } from '../application/observation-fixture';
function fixture() {
  const f = observationFixture(), sender = {}, handlers = new Map<string, (event: { sender: object }, ...args: unknown[]) => Promise<unknown>>();
  let stream = 's'; const pick = vi.fn<() => Promise<string | null>>(async () => 'C:\\Apps\\Editor.exe');
  const registerExecutable = vi.fn(() => ({ appKey: 'next', alias: 'Editor', category: 'other' as const, excluded: false }));
  const forgetExecutable = vi.fn(), clearExecutables = vi.fn();
  const dispose = registerObservationIpc({ register: (key, handler) => { handlers.set(key, handler); }, remove: key => { handlers.delete(key); },
    getSender: () => sender, getStream: () => stream, getRuntime: () => f.runtime, pick, registerExecutable, forgetExecutable, clearExecutables });
  const raw = (payload: unknown, source = sender) => handlers.get('wisp:observation-command')!({ sender: source }, payload);
  const command = (type: string, extra: Record<string, unknown> = {}) => raw({ type, streamId: 's', generation: f.runtime.getSettings().generation, ...extra });
  return { ...f, raw, command, pick, registerExecutable, forgetExecutable, clearExecutables, dispose, handlers, reload: () => { stream = 'new'; f.runtime.reset(); } };
}
it('uses trusted exact current commands; Renderer cannot supply title/path/native identity', async () => {
  const f = fixture();
  await expect(f.raw({ type: 'get', streamId: 's', generation: 0 }, {})).rejects.toThrow();
  for (const extra of [{ title: 'secret' }, { path: 'x.exe' }, { pid: 123 }, { appKey: 'bad' }, { generation: -1 }, { streamId: 'old' }, { generation: 0 }]) await expect(f.command('enable', extra)).rejects.toThrow();
  expect(f.runtime.getSettings().enabled).toBe(false); f.dispose(); expect(f.handlers.size).toBe(0);
});
it('picker returns opaque entry only and exclusion/remove/clear are Main-authoritative', async () => {
  const f = fixture(); const result = await f.command('pick'); expect(result).not.toHaveProperty('path'); expect(JSON.stringify(result)).not.toContain('C:');
  expect(f.registerExecutable).toHaveBeenCalledWith('C:\\Apps\\Editor.exe');
  await f.command('exclude', { appKey: 'next', excluded: true }); expect(f.runtime.getSettings().applications.at(-1)?.excluded).toBe(true);
  await f.command('remove', { appKey: 'next' }); expect(f.forgetExecutable).toHaveBeenCalledWith('next'); await f.command('clear'); expect(f.clearExecutables).toHaveBeenCalled(); expect(f.runtime.getSettings().applications).toEqual([]);
});
it.each(['reload', 'policy'] as const)('ignores delayed executable picker after%s', async change => {
  const f = fixture(); let resolve!: (path: string) => void; f.pick.mockImplementationOnce(() => new Promise(yes => { resolve = yes; }));
  const pending = f.command('pick'); if (change === 'reload') f.reload(); else f.runtime.enable(); resolve('C:\\Apps\\Editor.exe');
  await expect(pending).rejects.toThrow(); expect(f.registerExecutable).not.toHaveBeenCalled();
});
it('closed preview immediately drops title and disable clears both preview and helper consent', async () => {
  const f = fixture(); await f.command('enable'); f.sample(); expect(f.runtime.getSettings().preview).toBeNull(); await f.command('preview-open'); expect(f.runtime.getSettings().preview?.windowTitle).toBe('Synthetic title');
  await f.command('preview-close'); expect(f.runtime.getSettings().preview).toBeNull(); await f.command('disable'); expect(f.runtime.getSettings()).toMatchObject({ enabled: false, preview: null, previewOpen: false });
});
