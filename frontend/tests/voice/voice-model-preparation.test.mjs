import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { allowedModelUrl, prepareVoiceModel } from '../../scripts/prepare-voice-model.mjs';
const manifest = { model: 'onnx-community/whisper-tiny', revision: 'pinned', files: [{ path: 'config.json', size: 3, sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' }] };
const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function rootForTest() { const root = await mkdtemp(path.join(tmpdir(), 'wisp-voice-prepare-')); roots.push(root); return root; }
it('prepares pinned resources atomically then reuses them without network', async () => {
  const root = await rootForTest(); const fetcher = vi.fn(async () => new Response('abc'));
  const directory = await prepareVoiceModel({ root, manifest, fetcher });
  expect(await readFile(path.join(directory, 'config.json'), 'utf8')).toBe('abc');
  await prepareVoiceModel({ root, manifest, fetcher: () => { throw new Error('offline'); } });
  expect(fetcher).toHaveBeenCalledOnce();
});
it.each(['ab', 'abcd', 'bad'])('rejects invalid downloaded bytes and cleans partial resources: %s', async text => {
  const root = await rootForTest();
  await expect(prepareVoiceModel({ root, manifest, fetcher: async () => new Response(text) })).rejects.toThrow(/mismatch/u);
  expect(await readdir(path.join(root, 'voice-models', 'pinned'))).toEqual([]);
});
it('rejects unapproved redirect hosts and credentials before fetching them', async () => {
  const root = await rootForTest();
  const fetcher = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://evil.test/model' } }));
  await expect(prepareVoiceModel({ root, manifest, fetcher })).rejects.toThrow('origin rejected');
  expect(fetcher).toHaveBeenCalledOnce();
  expect(allowedModelUrl(new URL('https://user@huggingface.co/model'))).toBe(false);
  expect(allowedModelUrl(new URL('http://huggingface.co/model'))).toBe(false);
});
it('cancels a partial download without publishing incomplete resources', async () => {
  const root = await rootForTest(); const abort = new AbortController();
  await expect(prepareVoiceModel({ root, manifest, signal: abort.signal,
    fetcher: async () => { abort.abort(); return new Response('abc'); },
  })).rejects.toMatchObject({ name: 'AbortError' });
  expect(await readdir(path.join(root, 'voice-models', 'pinned'))).toEqual([]);
});

it('ships exactly the pinned manifest files and revision in packaged resources', async () => {
  const source = await readFile(new URL('../../src/infrastructure/voice/model-manifest.ts', import.meta.url), 'utf8');
  const pinned = JSON.parse(source.match(/export const VOICE_MODEL = (\{[\s\S]*\}) as const;/u)[1]);
  const packageConfig = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  expect(packageConfig.build.extraResources).toEqual([{
    from: `.cache/voice-models/${pinned.revision}`,
    to: `voice-models/${pinned.revision}`,
    filter: pinned.files.map(file => file.path),
  }]);
});
