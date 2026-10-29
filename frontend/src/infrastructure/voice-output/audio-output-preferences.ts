import { mkdir, open, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { IAudioOutputPreferences, AudioOutputPreferenceResult } from '../../application/ports/audio-output-preferences';
import { parseOutputDevice } from '../../shared/voice-output-validation';

/** Fixed local path; only the chosen opaque device ID is retained. */
export class FileAudioOutputPreferences implements IAudioOutputPreferences {
  private serial = Promise.resolve();
  constructor(private readonly directory: string) {}
  public async read(): Promise<AudioOutputPreferenceResult> {
    let handle;
    try {
      handle = await open(path.join(this.directory, 'audio-output.json'), 'r');
      const buffer = Buffer.alloc(4097); const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > 4096) return { ok: false };
      const value: unknown = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'));
      return { ok: true, ...parseOutputDevice(value) };
    } catch (error) { return error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT' ? { ok: true, deviceId: '' } : { ok: false }; }
    finally { await handle?.close(); }
  }
  public write(deviceId: string): Promise<AudioOutputPreferenceResult> {
    const operation = this.serial.then(() => this.persist(deviceId));
    this.serial = operation.then(() => undefined);
    return operation;
  }
  private async persist(deviceId: string): Promise<AudioOutputPreferenceResult> {
    const temporary = path.join(this.directory, `audio-output.${randomUUID()}.tmp`);
    try {
      const value = parseOutputDevice({ deviceId });
      await mkdir(this.directory, { recursive: true });
      await writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
      await rename(temporary, path.join(this.directory, 'audio-output.json'));
      return { ok: true, ...value };
    } catch { return { ok: false }; }
    finally { await rm(temporary, { force: true }).catch(() => undefined); }
  }
}
