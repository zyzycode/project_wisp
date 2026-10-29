import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { VOICE_MODEL } from './model-manifest';
type ModelFile = typeof VOICE_MODEL.files[number];
export class VoiceCacheError extends Error { constructor(public readonly code: 'integrity_failed' | 'download_failed') { super(code); } }
export function allowedModelUrl(url: URL): boolean {
  return url.protocol === 'https:' && !url.username && !url.password && (url.hostname === 'huggingface.co' || url.hostname === 'cdn-lfs.huggingface.co' || url.hostname === 'cdn-lfs-us-1.hf.co' || url.hostname === 'cas-bridge.xethub.hf.co' || url.hostname === 'us.aws.cdn.hf.co');
}
async function downloadResponse(url: URL, signal: AbortSignal): Promise<Response> {
  for (let redirects = 0; redirects <= 5; redirects++) {
    if (!allowedModelUrl(url)) throw new VoiceCacheError('download_failed');
    const response = await fetch(url, { signal, redirect: 'manual' });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location'); await response.body?.cancel();
      if (!location) throw new VoiceCacheError('download_failed');
      url = new URL(location, url); continue;
    }
    if (!response.ok || !response.body) { await response.body?.cancel(); throw new VoiceCacheError('download_failed'); }
    return response;
  }
  throw new VoiceCacheError('download_failed');
}
export async function verifiedFile(filename: string, file: ModelFile): Promise<boolean> {
  try {
    if ((await stat(filename)).size !== file.size) return false;
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(filename)) hash.update(chunk);
    return hash.digest('hex') === file.sha256;
  } catch { return false; }
}
export class VoiceModelCache {
  public readonly directory: string;
  constructor(root: string) { this.directory = path.join(root, 'voice-models', VOICE_MODEL.revision); }
  public async verify(signal?: AbortSignal): Promise<boolean> {
    for (const file of VOICE_MODEL.files) {
      signal?.throwIfAborted();
      if (!await verifiedFile(path.join(this.directory, file.path), file)) return false;
    }
    return true;
  }
  public async prepare(signal: AbortSignal, progress: (bytes: number) => void): Promise<void> {
    let completed = 0;
    for (const file of VOICE_MODEL.files) {
      signal.throwIfAborted();
      const filename = path.join(this.directory, file.path);
      if (await verifiedFile(filename, file)) { completed += file.size; progress(completed); continue; }
      await mkdir(path.dirname(filename), { recursive: true });
      const temporary = `${filename}.partial`;
      await rm(temporary, { force: true });
      const handle = await open(temporary, 'wx', 0o600);
      try {
        const response = await downloadResponse(new URL(`https://huggingface.co/${VOICE_MODEL.model}/resolve/${VOICE_MODEL.revision}/${file.path}`), signal);
        const declared = response.headers.get('content-length');
        if (declared !== null && Number(declared) !== file.size) { await response.body?.cancel(); throw new VoiceCacheError('integrity_failed'); }
        const hash = createHash('sha256'); let received = 0;
        const reader = response.body!.getReader();
        try {
          while (true) {
            signal.throwIfAborted(); const next = await reader.read(); if (next.done) break;
            received += next.value.length;
            if (received > file.size) throw new VoiceCacheError('integrity_failed');
            hash.update(next.value); await handle.writeFile(next.value); progress(completed + received);
          }
        } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
        if (received !== file.size || hash.digest('hex') !== file.sha256) throw new VoiceCacheError('integrity_failed');
        signal.throwIfAborted(); await handle.close(); await rename(temporary, filename);
        completed += file.size;
      } finally { await handle.close().catch(() => undefined); await rm(temporary, { force: true }); }
    }
  }
}
