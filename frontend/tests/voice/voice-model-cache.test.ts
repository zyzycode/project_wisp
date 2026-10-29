import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { VoiceModelCache } from '../../src/infrastructure/voice/model-cache';
vi.mock('../../src/infrastructure/voice/model-manifest', () => ({ VOICE_MODEL: { totalBytes: 3, revision: 'pinned', files: [{ path: 'config.json', size: 3, sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' }] } }));
const roots: string[] = [];
afterEach(async () => { vi.unstubAllGlobals(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() { const root = await mkdtemp(path.join(tmpdir(), 'wisp-voice-test-')); roots.push(root); return new VoiceModelCache(root); }
describe('installed model resources', () => {
  it('verifies an installed bundle offline without changing its files', async () => {
    const cache = await fixture(); await mkdir(cache.directory, { recursive: true });
    await writeFile(path.join(cache.directory, 'config.json'), 'abc');
    const fetcher = vi.fn(() => { throw new Error('offline'); }); vi.stubGlobal('fetch', fetcher);
    expect(await cache.verify()).toBe(true);
    expect(await readFile(path.join(cache.directory, 'config.json'), 'utf8')).toBe('abc');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([null, 'ab', 'abcd', 'bad'])('rejects missing or corrupt installed resources without downloading: %s', async text => {
    const cache = await fixture(); await mkdir(cache.directory, { recursive: true });
    if (text !== null) await writeFile(path.join(cache.directory, 'config.json'), text);
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    expect(await cache.verify()).toBe(false); expect(fetcher).not.toHaveBeenCalled();
  });
  it('honours cancellation before checking installed files', async () => {
    const cache = await fixture(); const abort = new AbortController(); abort.abort();
    await expect(cache.verify(abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});
