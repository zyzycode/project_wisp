import path from 'node:path';
import type { LocalAIBackendBootstrap, LocalAIBackendReady } from '../../application/ports/ai-connection.interface';
import { parsePersonalAIKey } from '../../shared/ai-connection-validation';

export function encodeLocalAIBootstrap(value: LocalAIBackendBootstrap): string {
  const apiKey = parsePersonalAIKey(value.apiKey);
  if (!/^[a-f0-9]{64}$/u.test(value.sessionToken) || !path.isAbsolute(value.ledgerPath)
      || /[\u0000-\u001f\u007f]/u.test(value.ledgerPath) || Buffer.byteLength(value.ledgerPath) > 4096) throw new TypeError('Invalid backend bootstrap');
  const record = `${JSON.stringify({ apiKey, sessionToken: value.sessionToken, ledgerPath: value.ledgerPath })}\n`;
  if (Buffer.byteLength(record) > 16 * 1024) throw new TypeError('Invalid backend bootstrap');
  return record;
}
export function parseLocalAIReady(bytes: Buffer): LocalAIBackendReady {
  if (bytes.byteLength > 256) throw new TypeError('Invalid backend readiness');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  // This private control channel has exactly two plain keys; duplicates/escapes/extra records fail closed.
  if (!/^\s*\{\s*(?:"kind"\s*:\s*"ready"\s*,\s*"port"\s*:\s*[0-9]+|"port"\s*:\s*[0-9]+\s*,\s*"kind"\s*:\s*"ready")\s*\}\n$/u.test(text)) throw new TypeError('Invalid backend readiness');
  const record: unknown = JSON.parse(text);
  if (!record || typeof record !== 'object' || !('port' in record) || typeof record.port !== 'number'
      || !Number.isInteger(record.port) || record.port < 1 || record.port > 65535) throw new TypeError('Invalid backend readiness');
  return { kind: 'ready', port: record.port };
}
export async function probeLocalAIHealth(port: number, token: string, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<boolean> {
  const response = await fetcher(`http://127.0.0.1:${port}/health`, {
    method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    redirect: 'error', credentials: 'omit', cache: 'no-store', signal,
  });
  if (response.status !== 200 || response.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json' || !response.body) return false;
  const reader = response.body.getReader();
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', abort, { once: true });
  let size = 0, content = '';
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    for (;;) {
      if (signal.aborted) return false;
      const chunk = await reader.read();
      if (signal.aborted) return false;
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 16 * 1024) return false;
      content += decoder.decode(chunk.value, { stream: true });
    }
    content += decoder.decode();
    const body: unknown = JSON.parse(content);
    return !!body && typeof body === 'object' && Object.keys(body).length === 1 && 'status' in body && body.status === 'ok';
  } finally {
    signal.removeEventListener('abort', abort);
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** Only OS runtime essentials pass to the child; never inherit provider settings or secrets. */
export function localAIChildEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = { PYTHONUNBUFFERED: '1', PYTHONDONTWRITEBYTECODE: '1', PYTHONUTF8: '1' };
  for (const name of ['PATH', 'HOME', 'USERPROFILE', 'SYSTEMROOT', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL']) {
    const value = source[name];
    if (value !== undefined) result[name] = value;
  }
  return result;
}
