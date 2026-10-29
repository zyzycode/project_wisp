import { safeStorage } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { IUserAIKeyStore, UserAIKeyStoreResult } from '../../application/ports/ai-connection.interface';
import { parsePersonalAIKey } from '../../shared/ai-connection-validation';

type Encryption = Pick<Electron.SafeStorage, 'isAsyncEncryptionAvailable' | 'getSelectedStorageBackend' | 'encryptStringAsync' | 'decryptStringAsync'>;
type Files = Pick<typeof fs, 'mkdir' | 'readFile' | 'writeFile' | 'rename' | 'unlink' | 'chmod' | 'lstat'>;
const storageError = { ok: false, code: 'storage_error' } as const;
const unavailable = { ok: false, code: 'secure_storage_unavailable' } as const;
const success = { ok: true, value: undefined } as const;
function missing(error: unknown): boolean { return error instanceof Error && 'code' in error && error.code === 'ENOENT'; }

/** Main-only encrypted storage. No plaintext fallback or credential projection exists. */
export class ProtectedUserAIKeyStore implements IUserAIKeyStore {
  private readonly file: string;
  constructor(userData: string, private readonly encryption: Encryption = safeStorage,
    private readonly files: Files = fs, private readonly platform = process.platform) {
    this.file = path.join(userData, 'personal-openai-key.encrypted');
  }
  async isAvailable(): Promise<boolean> {
    try {
      if (!await this.encryption.isAsyncEncryptionAvailable()) return false;
      if (this.platform === 'linux' && ['basic_text', 'unknown'].includes(this.encryption.getSelectedStorageBackend())) return false;
      return true;
    } catch { return false; }
  }
  async load(): Promise<UserAIKeyStoreResult<string | null>> {
    if (!await this.isAvailable()) return unavailable;
    try {
      const stat = await this.files.lstat(this.file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024) return storageError;
      const encrypted = await this.files.readFile(this.file);
      const decrypted = await this.encryption.decryptStringAsync(encrypted);
      return { ok: true, value: parsePersonalAIKey(decrypted.result) };
    } catch (error) { return missing(error) ? { ok: true, value: null } : storageError; }
  }
  async hasSavedKey(): Promise<UserAIKeyStoreResult<boolean>> {
    try { await this.files.lstat(this.file); return { ok: true, value: true }; }
    catch (error) { return missing(error) ? { ok: true, value: false } : storageError; }
  }
  async save(apiKey: string): Promise<UserAIKeyStoreResult<void>> {
    if (!await this.isAvailable()) return unavailable;
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      const encrypted = await this.encryption.encryptStringAsync(parsePersonalAIKey(apiKey));
      if (encrypted.byteLength === 0 || encrypted.byteLength > 16 * 1024) return storageError;
      await this.files.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
      await this.files.writeFile(temporary, encrypted, { flag: 'wx', mode: 0o600 });
      await this.files.chmod(temporary, 0o600);
      await this.files.rename(temporary, this.file);
      return success;
    } catch { return storageError; }
    finally { await this.files.unlink(temporary).catch(() => undefined); }
  }
  async remove(): Promise<UserAIKeyStoreResult<void>> {
    // Removal remains possible when an OS keychain is locked or the file is corrupt.
    try { await this.files.unlink(this.file); return success; }
    catch (error) { return missing(error) ? success : storageError; }
  }
}
