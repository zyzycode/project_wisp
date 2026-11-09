import { createHash } from 'node:crypto';
import type { IScreenObservationProvider, PreparedScreenObservation, ScreenSendAuthorization } from '../../application/ports/screen-observation.interface';
import type { BackendScreenObservationCapability, ScreenObservationEvidence } from '../../application/ports/backend-screen-observation-contract';
import { parseScreenJson } from './screen-json';
import { parseBackendScreenRequest, parseBackendScreenResponse, parseScreenCapability } from './backend-screen-observation-validation';

interface Options {
  readonly baseUrl: string;
  readonly sessionToken?: string;
  readonly now: () => number;
  readonly fetch: typeof fetch;
  readonly acquire: (requestId: string) => boolean;
  readonly release: (requestId: string) => void;
}
/** Shares ExternalAIProviderClient admission, including retired network exchanges. */
export class BackendScreenTransport implements IScreenObservationProvider {
  private lease: string | null = null;
  private pending = false;
  private released = false;
  private readonly origin: string | null;
  constructor(private readonly options: Options) {
    this.origin = options.sessionToken && /^[a-f0-9]{64}$/u.test(options.sessionToken) && /^http:\/\/127\.0\.0\.1:[0-9]{1,5}$/u.test(options.baseUrl) ? options.baseUrl : null;
  }
  public reserve(requestId: string): boolean {
    if (!this.origin || this.lease || !this.options.acquire(requestId)) return false;
    this.lease = requestId; this.released = false; return true;
  }
  public release(requestId: string): void {
    if (this.lease !== requestId) return;
    this.released = true;
    if (!this.pending) { this.lease = null; this.options.release(requestId); }
  }
  public async getCapability(signal: AbortSignal): Promise<BackendScreenObservationCapability> {
    return parseScreenCapability(await this.exchange('GET', '/v1/screen-observation/capability', undefined, signal, 1000, 1024));
  }
  public async observe(prepared: PreparedScreenObservation, authorization: ScreenSendAuthorization, locale: 'ru' | 'en', signal: AbortSignal): Promise<ScreenObservationEvidence> {
    if (this.lease !== prepared.context.requestId || authorization.context !== prepared.context || authorization.previewId !== prepared.previewId || authorization.digest !== prepared.digest
      || this.options.now() >= authorization.expiresAtMs || createHash('sha256').update(Buffer.from(prepared.image.dataBase64, 'base64')).digest('hex') !== prepared.digest) throw new Error('Screen unavailable');
    const request = parseBackendScreenRequest({ requestId: prepared.context.requestId, stream: false, locale, policyRevision: authorization.policyRevision, image: prepared.image });
    return parseBackendScreenResponse(await this.exchange('POST', '/v1/screen-observation', JSON.stringify(request), signal, 7000, 4096), prepared.context.requestId);
  }
  private async exchange(method: 'GET' | 'POST', path: string, body: string | undefined, signal: AbortSignal, deadlineMs: number, byteCap: number): Promise<unknown> {
    const lease = this.lease;
    if (!this.origin || !lease || this.pending || this.released || signal.aborted) throw new Error('Screen unavailable');
    this.pending = true;
    const controller = new AbortController(), deadline = this.options.now() + deadlineMs;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancel: (() => void) | undefined;
    const stopped = new Promise<never>((_resolve, reject) => { cancel = () => { controller.abort(); reject(new Error('Screen cancelled')); }; timer = setTimeout(cancel, deadlineMs); });
    signal.addEventListener('abort', cancel!, { once: true });
    const work = async (): Promise<unknown> => {
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      const cancelReader = () => { void reader?.cancel().catch(() => undefined); };
      controller.signal.addEventListener('abort', cancelReader, { once: true });
      try {
        const response = await this.options.fetch(`${this.origin}${path}`, { method, ...(body === undefined ? {} : { body }), headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${this.options.sessionToken}` }, redirect: 'error', credentials: 'omit', cache: 'no-store', signal: controller.signal });
        if (response.status !== 200 || response.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json' || !response.body) throw new Error('Screen unavailable');
        reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8', { fatal: true });
        let size = 0, text = '';
        for (;;) {
          if (controller.signal.aborted || this.options.now() >= deadline) throw new Error('Screen timeout');
          const item = await reader.read();
          if (item.done) break;
          size += item.value.byteLength;
          if (size > byteCap) throw new Error('Screen response too large');
          text += decoder.decode(item.value, { stream: true });
        }
        if (controller.signal.aborted || this.options.now() >= deadline) throw new Error('Screen timeout');
        return parseScreenJson(text + decoder.decode());
      } finally {
        controller.signal.removeEventListener('abort', cancelReader);
        if (reader) { void reader.cancel().catch(() => undefined); reader.releaseLock(); }
        this.pending = false;
        if (this.released && this.lease === lease) { this.lease = null; this.options.release(lease); }
      }
    };
    try { return await Promise.race([work(), stopped]); }
    finally { clearTimeout(timer); signal.removeEventListener('abort', cancel!); controller.abort(); }
  }
}
