import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { VOICE_MODEL } from './model-manifest';

type ModelFile = { readonly size: number; readonly sha256: string };
export async function verifiedFile(filename: string, file: ModelFile): Promise<boolean> {
  try {
    if ((await stat(filename)).size !== file.size) return false;
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(filename)) hash.update(chunk);
    return hash.digest('hex') === file.sha256;
  } catch { return false; }
}
/** Read-only installed model resources. Network preparation belongs to developer tooling. */
export class VoiceModelCache {
  public readonly directory: string;
  constructor(root: string) { this.directory = path.join(root, 'voice-models', VOICE_MODEL.revision); }
  public async verify(signal?: AbortSignal): Promise<boolean> {
    for (const file of VOICE_MODEL.files) {
      signal?.throwIfAborted();
      if (!await verifiedFile(path.join(this.directory, file.path), file)) return false;
    }
    signal?.throwIfAborted();
    return true;
  }
}
