import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ProtectedUserAIKeyStore } from '../../src/infrastructure/platform/protected-user-ai-key-store';
vi.mock('electron', () => ({ safeStorage: {} }));
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wisp-key-store-test-')); roots.push(root);
  const encryption = {
    isAsyncEncryptionAvailable: vi.fn(async () => true), getSelectedStorageBackend: vi.fn(() => 'gnome_libsecret' as const),
    encryptStringAsync: vi.fn(async () => Buffer.from('OS-encrypted-test-ciphertext')),
    decryptStringAsync: vi.fn(async () => ({ result: 'synthetic-test-key', shouldReEncrypt: false })),
  };
  return { root, encryption, store: new ProtectedUserAIKeyStore(root, encryption, fs, 'darwin'), file: path.join(root, 'personal-openai-key.encrypted') };
}
describe('protected personal key file', () => {
  it('stores only OS ciphertext with restricted permissions and exposes presence separately', async () => {
    const f = await fixture();
    expect(await f.store.hasSavedKey()).toEqual({ ok: true, value: false });
    expect(await f.store.save('synthetic-test-key')).toEqual({ ok: true, value: undefined });
    expect(await fs.readFile(f.file, 'utf8')).toBe('OS-encrypted-test-ciphertext');
    expect((await fs.stat(f.file)).mode & 0o777).toBe(0o600);
    expect(await f.store.load()).toEqual({ ok: true, value: 'synthetic-test-key' });
    expect(f.encryption.encryptStringAsync).toHaveBeenCalledOnce();
  });
  it.each(['basic_text', 'unknown'] as const)('fails closed on Linux %s without touching disk or encrypting', async backend => {
    const f = await fixture();
    const store = new ProtectedUserAIKeyStore(f.root, { ...f.encryption, getSelectedStorageBackend: () => backend }, fs, 'linux');
    expect(await store.save('synthetic-test-key')).toEqual({ ok: false, code: 'secure_storage_unavailable' });
    expect(f.encryption.encryptStringAsync).not.toHaveBeenCalled();
    expect(await fs.readdir(f.root)).toEqual([]);
  });
  it('preserves the previous encrypted file when an atomic replacement fails', async () => {
    const f = await fixture(); await fs.writeFile(f.file, 'previous-ciphertext');
    const store = new ProtectedUserAIKeyStore(f.root, f.encryption, { ...fs, rename: vi.fn(async () => { throw new Error('sensitive internal details'); }) }, 'darwin');
    expect(await store.save('synthetic-test-key')).toEqual({ ok: false, code: 'storage_error' });
    expect(await fs.readFile(f.file, 'utf8')).toBe('previous-ciphertext');
    expect(await fs.readdir(f.root)).toEqual(['personal-openai-key.encrypted']);
  });
  it('reports corrupt/decryption failure safely, retains the file and allows removal', async () => {
    const f = await fixture(); await fs.writeFile(f.file, 'broken-ciphertext');
    f.encryption.decryptStringAsync.mockRejectedValue(new Error('secret OS detail'));
    expect(await f.store.load()).toEqual({ ok: false, code: 'storage_error' });
    expect(await f.store.hasSavedKey()).toEqual({ ok: true, value: true });
    f.encryption.isAsyncEncryptionAvailable.mockResolvedValue(false);
    expect(await f.store.load()).toEqual({ ok: false, code: 'secure_storage_unavailable' });
    expect(await f.store.remove()).toEqual({ ok: true, value: undefined });
    expect(await f.store.hasSavedKey()).toEqual({ ok: true, value: false });
  });
  it('rejects a symlink rather than decrypting a file outside userData', async () => {
    const f = await fixture(); await fs.symlink(path.join(f.root, 'elsewhere'), f.file);
    expect(await f.store.load()).toEqual({ ok: false, code: 'storage_error' });
    expect(f.encryption.decryptStringAsync).not.toHaveBeenCalled();
  });
});
