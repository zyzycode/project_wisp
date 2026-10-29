import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { VoiceModelCache, allowedModelUrl } from '../../src/infrastructure/voice/model-cache';
vi.mock('../../src/infrastructure/voice/model-manifest', () => ({ VOICE_MODEL: { model: 'onnx-community/whisper-tiny', revision: 'pinned', files: [{ path: 'config.json', size: 3, sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' }] } }));
const roots: string[] = [];
afterEach(async () => { vi.unstubAllGlobals(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() { const root = await mkdtemp(path.join(tmpdir(), 'wisp-voice-test-')); roots.push(root); return new VoiceModelCache(root); }
describe('verified model cache', () => {
  it('downloads atomically, reuses offline and detects later corruption', async () => {
    const cache = await fixture(); const fetcher = vi.fn(async () => new Response('abc'));
    vi.stubGlobal('fetch', fetcher); const progress: number[] = [];
    await cache.prepare(new AbortController().signal, n => progress.push(n)); expect(progress.at(-1)).toBe(3);
    expect(await cache.verify()).toBe(true); expect(await readFile(path.join(cache.directory, 'config.json'), 'utf8')).toBe('abc');
    vi.stubGlobal('fetch', () => { throw new Error('offline'); }); await cache.prepare(new AbortController().signal, () => undefined);
    await writeFile(path.join(cache.directory, 'config.json'), 'bad'); expect(await cache.verify()).toBe(false);
  });
  it.each(['ab', 'abcd', 'bad'])('never publishes truncated, oversized or wrong hash %s', async text => {
    const cache = await fixture(); vi.stubGlobal('fetch', async () => new Response(text));
    await expect(cache.prepare(new AbortController().signal, () => undefined)).rejects.toThrow('integrity_failed');
    expect(await cache.verify()).toBe(false); await expect(readFile(path.join(cache.directory, 'config.json.partial'))).rejects.toThrow();
  });
  it('denies arbitrary redirect target and credentials', async () => {
    const cache = await fixture(); vi.stubGlobal('fetch', async () => new Response(null, { status: 302, headers: { location: 'https://evil.test/model' } }));
    await expect(cache.prepare(new AbortController().signal, () => undefined)).rejects.toThrow('download_failed');
    expect(allowedModelUrl(new URL('https://user@huggingface.co/model'))).toBe(false);
    expect(allowedModelUrl(new URL('http://huggingface.co/model'))).toBe(false);
  });
});
