import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function allowedModelUrl(url) {
  return url.protocol === 'https:' && !url.username && !url.password &&
    ['huggingface.co', 'cdn-lfs.huggingface.co', 'cdn-lfs-us-1.hf.co', 'cas-bridge.xethub.hf.co', 'us.aws.cdn.hf.co'].includes(url.hostname);
}
async function installed(filename, file) {
  try {
    if ((await stat(filename)).size !== file.size) return false;
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(filename)) hash.update(chunk);
    return hash.digest('hex') === file.sha256;
  } catch { return false; }
}
async function responseFor(url, signal, fetcher) {
  for (let redirects = 0; redirects <= 5; redirects++) {
    if (!allowedModelUrl(url)) throw new Error('Model download origin rejected');
    const response = await fetcher(url, { signal, redirect: 'manual' });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location'); await response.body?.cancel();
      if (!location) throw new Error('Missing model redirect');
      url = new URL(location, url); continue;
    }
    if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error('Model download failed'); }
    return response;
  }
  throw new Error('Too many model redirects');
}
async function download(file, manifest, filename, signal, fetcher) {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${randomUUID()}.partial`;
  const handle = await open(temporary, 'wx', 0o600);
  try {
    const response = await responseFor(new URL(`https://huggingface.co/${manifest.model}/resolve/${manifest.revision}/${file.path}`), signal, fetcher);
    const declared = response.headers.get('content-length');
    if (declared !== null && Number(declared) !== file.size) { await response.body.cancel(); throw new Error('Model size mismatch'); }
    const hash = createHash('sha256'); let received = 0;
    const reader = response.body.getReader();
    try {
      while (true) {
        signal.throwIfAborted();
        const next = await reader.read(); if (next.done) break;
        received += next.value.length;
        if (received > file.size) throw new Error('Model size mismatch');
        hash.update(next.value); await handle.writeFile(next.value);
      }
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    if (received !== file.size || hash.digest('hex') !== file.sha256) throw new Error('Model integrity mismatch');
    signal.throwIfAborted(); await handle.close(); await rename(temporary, filename);
  } finally { await handle.close().catch(() => undefined); await rm(temporary, { force: true }); }
}
async function pinnedManifest() {
  const source = await readFile(path.join(frontendRoot, 'src', 'infrastructure', 'voice', 'model-manifest.ts'), 'utf8');
  const match = source.match(/export const VOICE_MODEL = (\{[\s\S]*\}) as const;/u);
  if (!match) throw new Error('Pinned voice manifest is invalid');
  return JSON.parse(match[1]);
}
/** Runs only in developer/release tooling; the installed application never downloads models. */
export async function prepareVoiceModel(options = {}) {
  const manifest = options.manifest ?? await pinnedManifest();
  const root = options.root ?? path.join(frontendRoot, '.cache');
  const signal = options.signal ?? AbortSignal.timeout(600_000);
  const fetcher = options.fetcher ?? fetch;
  const directory = path.join(root, 'voice-models', manifest.revision);
  for (const file of manifest.files) {
    signal.throwIfAborted();
    const filename = path.join(directory, file.path);
    if (!await installed(filename, file)) await download(file, manifest, filename, signal, fetcher);
  }
  signal.throwIfAborted();
  return directory;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepareVoiceModel();
  console.log('Pinned voice model verified and ready for offline delivery.');
}
