import { BackendScreenTransport } from './backend-screen-transport';
import { projectInteractionChat, projectInteractionTouch, parseInteractionChatResponse, parseInteractionTouchResponse, parseInteractionError } from './backend-interaction-validation';
import type { IObservationProvider, ObservationProviderRequest } from '../../application/ports/observation-provider.interface';
import { projectObservationRequest, parseObservationResponse, parseObservationError } from './backend-observation-validation';
import type { ISummaryGenerator } from '../../application/ports/summary';
import { parseSummaryRequest, parseSummaryResponse, parseSummaryError } from './backend-summary-validation';
import type { AIEventProviderRequest, AIEventProviderResponse, IAIEventProvider } from '../../application/ports/ai-event-provider.interface';
import { projectEventRequest, parseEventResponse, parseEventError } from './backend-events-validation';
import type { AIProviderFallbackReason, AIProviderRequest, AIProviderResponse, AIProviderStatus, IAIProvider } from '../../application/ports/ai-provider.interface';
import { DEFAULT_AI_REQUEST_POLICY } from '../../application/ports/ai-request-policy';
import { DIALOGUE_FALLBACK } from '../../application/services/dialogue-provider-result';

interface ExternalAIProviderOptions {
  readonly baseUrl: string;
  readonly development: boolean;
  readonly now: () => number;
  readonly fetch?: typeof fetch;
  /** Private Main-owned loopback transport credential, never a provider key. */
  readonly sessionToken?: string;
  /** Main admission immediately before an autonomous HTTP send, never chat/touch/summary. */
  readonly admitEventDispatch?: (requestId: string) => boolean;
  readonly eventDispatched?: (requestId: string) => void;
}
class ProtocolError extends Error {}
class TransportTimeout extends Error {}
type BackendOperation = 'chat' | 'touch' | 'events' | 'summary' | 'observation';
function boundedCancellation(signal: AbortSignal, graceMs: number | undefined) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectCancellation: (() => void) | undefined;
  const promise = new Promise<never>((_resolve, reject) => { rejectCancellation = () => reject(new TransportTimeout()); });
  const abort = () => {
    if (graceMs === 0) rejectCancellation?.();
    else if (graceMs !== undefined) timer = setTimeout(() => rejectCancellation?.(), graceMs);
  };
  signal.addEventListener('abort', abort, { once: true });
  return { promise, dispose: () => { clearTimeout(timer); signal.removeEventListener('abort', abort); } };
}

/** Trusted Main configuration only; redirects, cookies and provider secrets are forbidden. */
function endpoint(baseUrl: string, development: boolean, operation: BackendOperation): URL {
  const url = new URL(baseUrl);
  const loopback = url.hostname === 'localhost' || url.hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/u.test(url.hostname);
  if ((url.protocol !== 'https:' && !(development && loopback && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash) throw new TypeError('Invalid backend URL');
  url.pathname = `${url.pathname.replace(/\/$/u, '')}/v1/${operation}`;
  return url;
}
async function readBoundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') throw new ProtocolError('Invalid response content type');
  if (!response.body) throw new ProtocolError('Missing response body');
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0, text = '';
  try {
    for (;;) {
      if (signal.aborted) throw new TransportTimeout();
      const chunk = await reader.read();
      if (signal.aborted) throw new TransportTimeout();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 16 * 1024) throw new ProtocolError('Response too large');
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as unknown;
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    if (error instanceof SyntaxError || error instanceof TypeError) throw new ProtocolError('Invalid response JSON');
    throw error;
  } finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); }
}

export class ExternalAIProviderClient implements IAIProvider, IAIEventProvider, ISummaryGenerator, IObservationProvider {
  public readonly supportsDialogueTopic = true as const;
  private cancellableRequest: { id: string; controller: AbortController } | undefined;
  private readonly urls: Readonly<Record<BackendOperation, URL>>;
  private readonly fetch: typeof fetch;
  private readonly headers: Readonly<Record<string, string>>;
  private activeRequestId: string | undefined;
  private screenLease: string | undefined;
  public readonly screenObservation: BackendScreenTransport;
  constructor(private readonly options: ExternalAIProviderOptions) {
    const local = options.sessionToken !== undefined;
    if (local && (!/^[a-f0-9]{64}$/u.test(options.sessionToken!) || !/^http:\/\/127\.0\.0\.1:[0-9]{1,5}$/u.test(options.baseUrl))) throw new TypeError('Invalid local backend configuration');
    this.headers = { 'Content-Type': 'application/json', Accept: 'application/json', ...(local ? { Authorization: `Bearer ${options.sessionToken}` } : {}) };
    const development = options.development || local;
    this.urls = { chat: endpoint(options.baseUrl, development, 'chat'), touch: endpoint(options.baseUrl, development, 'touch'), events: endpoint(options.baseUrl, development, 'events'), summary: endpoint(options.baseUrl, development, 'summary'), observation: endpoint(options.baseUrl, development, 'observation') };
    this.fetch = options.fetch ?? globalThis.fetch;
    this.screenObservation = new BackendScreenTransport({ ...options, fetch: this.fetch, acquire: id => { if (this.activeRequestId || this.screenLease) return false; this.screenLease = id; return true; }, release: id => { if (this.screenLease === id) this.screenLease = undefined; } });
  }
  public canIncludeLifeReflection(request: AIProviderRequest): boolean { return projectInteractionChat(request).lifeReflection !== undefined; }
  public canIncludeSummary(request: AIProviderRequest): boolean {
    return projectInteractionChat(request).summary !== undefined;
  }
  public async getStatus(): Promise<AIProviderStatus> {
    if (this.activeRequestId) return { kind: 'thinking', activeRequestId: this.activeRequestId };
    return { kind: 'ready' };
  }
  public async generateResponse(request: AIProviderRequest): Promise<AIProviderResponse> {
    const projected = projectInteractionChat(request);
    const body = JSON.stringify(projected);
    if (new TextEncoder().encode(body).byteLength > 32 * 1024) throw new TypeError('Request too large');
    if (this.activeRequestId || this.screenLease) throw new Error('Transport unavailable');
    const startedAt = this.options.now();
    try {
      return await this.post<AIProviderResponse>('chat', request.requestId, body, (response, value) => {
        if (response.status !== 200) {
          try { parseInteractionError(value, request.requestId, response.status); }
          catch { throw new ProtocolError('Invalid backend error'); }
          const reason = response.status === 504 ? 'timeout' : [429, 503].includes(response.status) ? 'provider_unavailable' : 'unexpected_error';
          return this.fallback(request.requestId, reason, startedAt);
        }
        let result;
        try { result = parseInteractionChatResponse(value, request.requestId, request.userMessage.text, projected.effectPolicy); }
        catch { throw new ProtocolError('Invalid backend success'); }
        const decision = result.decision;
        return { requestId: result.requestId, status: 'ok',
          ...('appraisal' in result ? { appraisal: result.appraisal } : {}),
          ...('memoryCandidates' in result ? { memoryCandidates: result.memoryCandidates } : {}), reply: { text: result.text, ...(decision?.tone === undefined ? {} : { tone: decision.tone }) },
          suggestedBehavior: decision?.behavior ?? 'respond', confidence: decision?.confidence ?? 1,
          ...(decision?.mood === undefined || decision.mood === 'playful' ? {} : { suggestedMood: decision.mood }),
          diagnostics: { provider: 'external', latencyMs: Math.max(0, this.options.now() - startedAt) } };
      }, undefined, startedAt);
    } catch (error) {
      if (error instanceof ProtocolError) throw error;
      return this.fallback(request.requestId, error instanceof TransportTimeout ? 'timeout' : 'provider_unavailable', startedAt);
    }
  }
  public cancel(requestId: string): void { if (this.cancellableRequest?.id === requestId) this.cancellableRequest.controller.abort(); }
  public async generateEvent(request: AIEventProviderRequest): Promise<AIEventProviderResponse> {
    const touch = request.event.type === 'user_touch';
    const projected = touch ? projectInteractionTouch(request) : projectEventRequest(request);
    const body = JSON.stringify(projected);
    if (this.activeRequestId || this.screenLease) throw new Error('Events unavailable');
    try { return await this.post(touch ? 'touch' : 'events', request.requestId, body, (response, value) => {
      try {
        if (response.status !== 200) {
          touch ? parseInteractionError(value, request.requestId, response.status) : parseEventError(value, request.requestId, response.status);
          throw new Error(response.status === 401 ? 'auth' : response.status === 504 ? 'timeout' : 'unavailable');
        }
        return touch ? parseInteractionTouchResponse(value, request.requestId, 'effectPolicy' in projected ? projected.effectPolicy : 'suppressed') : parseEventResponse(value, request.requestId);
      } catch (error) {
        if (error instanceof TypeError || error instanceof SyntaxError) throw new ProtocolError('Invalid event response');
        throw error;
      }
    }); } catch (error) {
      if (error instanceof TransportTimeout) throw new Error('timeout');
      if (error instanceof ProtocolError) throw new Error('invalid_response');
      if (error instanceof TypeError) throw new Error('unavailable');
      throw error;
    }
  }
  public async generateSummary(request: Parameters<ISummaryGenerator['generateSummary']>[0], signal: AbortSignal): Promise<string> {
    if (this.activeRequestId || this.screenLease || signal.aborted) throw new Error('Summary unavailable');
    const body = JSON.stringify(parseSummaryRequest({ ...request, stream: false }));
    return this.post('summary', request.requestId, body, (response, value) => {
      if (response.status !== 200) { parseSummaryError(value, request.requestId, response.status); throw new ProtocolError('Summary failed'); }
      return parseSummaryResponse(value, request.requestId).text;
    }, signal);
  }
  public canStartObservation(): boolean { return this.activeRequestId === undefined && this.screenLease === undefined; }
  public async generateObservation(request: ObservationProviderRequest, signal: AbortSignal): Promise<string> {
    if (this.activeRequestId || this.screenLease || signal.aborted) throw new Error('Observation unavailable');
    const body = JSON.stringify(projectObservationRequest(request));
    return this.post('observation', request.requestId, body, (response, value) => {
      if (response.status !== 200) { parseObservationError(value, request.requestId, response.status); throw new ProtocolError('Observation unavailable'); }
      return parseObservationResponse(value, request.requestId);
    }, signal);
  }
  private async post<T>(operation: BackendOperation, requestId: string, body: string,
    parse: (response: Response, value: unknown) => T, signal?: AbortSignal, startedAt = this.options.now()): Promise<T> {
    const timeoutMs = operation === 'summary' ? 12000
      : operation === 'events' || operation === 'observation' ? 3000 : DEFAULT_AI_REQUEST_POLICY.transportTimeoutMs;
    // Summary cancels immediately; observation keeps its original deadline; chat/events allow draining grace.
    const graceMs = operation === 'summary' ? 0 : operation === 'observation' ? undefined : 3000;
    const controller = new AbortController();
    const cancellation = boundedCancellation(controller.signal, graceMs);
    this.activeRequestId = requestId;
    if (!signal) this.cancellableRequest = { id: requestId, controller };
    let settled = false, completed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { reject(new TransportTimeout()); controller.abort(); }, timeoutMs);
    });
    const release = () => { if (this.activeRequestId === requestId) this.activeRequestId = undefined; };
    const exchange = async () => {
      try {
        if (controller.signal.aborted || (operation === 'events' && this.options.admitEventDispatch?.(requestId) === false)) throw new Error('unavailable');
        const pendingResponse = this.fetch(this.urls[operation], { method: 'POST', body, headers: this.headers,
          redirect: 'error', credentials: 'omit', cache: 'no-store', signal: controller.signal });
        if (operation === 'events') this.options.eventDispatched?.(requestId);
        const response = await pendingResponse;
        const value = await readBoundedJson(response, controller.signal);
        if (controller.signal.aborted || (operation !== 'summary' && this.options.now() - startedAt >= timeoutMs)) throw new TransportTimeout();
        return parse(response, value);
      } finally {
        settled = true;
        // Public timeout/cancel can finish first; do not admit another fetch until this one settles.
        if (completed) release();
      }
    };
    try { return await Promise.race([exchange(), timeout, cancellation.promise]); }
    catch (error) { controller.abort(); throw error; }
    finally {
      completed = true; clearTimeout(timer); cancellation.dispose();
      signal?.removeEventListener('abort', abort);
      if (signal) controller.abort();
      if (this.cancellableRequest?.controller === controller) this.cancellableRequest = undefined;
      if (settled) release();
    }
  }
  private fallback(requestId: string, fallbackReason: AIProviderFallbackReason, startedAt: number): AIProviderResponse {
    return { requestId, status: 'fallback', reply: { text: DIALOGUE_FALLBACK }, confidence: 0,
      diagnostics: { provider: 'external', latencyMs: Math.max(0, this.options.now() - startedAt), fallbackReason } };
  }
}
