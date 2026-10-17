import type { IObservationProvider, ObservationProviderRequest } from '../../application/ports/observation-provider.interface';
import { projectObservationRequest, parseObservationResponse, parseObservationError } from './backend-observation-validation';
import type { ISummaryGenerator } from '../../application/ports/summary';
import { parseSummaryRequest, parseSummaryResponse, projectSummaryChat, parseSummaryChatResponse, parseSummaryError } from './backend-summary-validation';
import type { AIEventProviderRequest, AIEventProviderResponse, IAIEventProvider } from '../../application/ports/ai-event-provider.interface';
import { projectEventRequest, projectEventAwareChat, parseEventAwareChat, parseEventResponse, parseEventError } from './backend-events-validation';
import { projectBackendMemoryRequest, parseBackendMemorySuccess, parseBackendMemoryError } from './backend-memory-validation';
import type { AIProviderFallbackReason, AIProviderRequest, AIProviderResponse, AIProviderStatus, IAIProvider } from '../../application/ports/ai-provider.interface';
import { DEFAULT_AI_REQUEST_POLICY } from '../../application/ports/ai-request-policy';
import { DIALOGUE_FALLBACK } from '../../application/services/dialogue-provider-result';
import { projectBackendRequest } from './backend-request-projection';
import { parseBackendError, parseBackendSuccess } from './backend-response-validation';
import { projectTouchRequest, parseTouchResponse } from './backend-touch-validation';

interface ExternalAIProviderOptions {
  readonly baseUrl: string;
  readonly apiVersion?: 1 | 2 | 3 | 5;
  readonly development: boolean;
  readonly now: () => number;
  readonly fetch?: typeof fetch;
}
class ProtocolError extends Error {}
class TransportTimeout extends Error {}

/** Trusted Main configuration only; redirects, cookies and provider secrets are forbidden. */
function endpoint(baseUrl: string, development: boolean, apiVersion: 1 | 2 | 3 | 5): URL {
  const url = new URL(baseUrl);
  const loopback = url.hostname === 'localhost' || url.hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/u.test(url.hostname);
  if ((url.protocol !== 'https:' && !(development && loopback && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash) throw new TypeError('Invalid backend URL');
  url.pathname = `${url.pathname.replace(/\/$/u, '')}/v${apiVersion}/chat`;
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
  private chatAbort: { id: string; controller: AbortController } | undefined;
  private eventAbort: { id: string; controller: AbortController } | undefined;
  private readonly url: URL;
  private readonly fetch: typeof fetch;
  private activeRequestId: string | undefined;
  constructor(private readonly options: ExternalAIProviderOptions) {
    this.url = endpoint(options.baseUrl, options.development, options.apiVersion ?? 1);
    this.fetch = options.fetch ?? globalThis.fetch;
  }
  public canIncludeSummary(request: AIProviderRequest): boolean {
    return this.options.apiVersion === 5 && projectSummaryChat(request).summary !== undefined;
  }
  public async getStatus(): Promise<AIProviderStatus> {
    if (this.activeRequestId) return { kind: 'thinking', activeRequestId: this.activeRequestId };
    return { kind: 'ready' };
  }
  public async generateResponse(request: AIProviderRequest): Promise<AIProviderResponse> {
    const body = JSON.stringify(this.options.apiVersion === 5 ? projectSummaryChat(request) : this.options.apiVersion === 3 ? projectEventAwareChat(request) : this.options.apiVersion === 2 ? projectBackendMemoryRequest(request) : projectBackendRequest(request));
    if (new TextEncoder().encode(body).byteLength > 32 * 1024) throw new TypeError('Request too large');
    if (this.activeRequestId) throw new Error('Transport unavailable');
    const startedAt = this.options.now();
    const controller = new AbortController();
    this.chatAbort = { id: request.requestId, controller };
    this.activeRequestId = request.requestId;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { reject(new TransportTimeout()); controller.abort(); }, DEFAULT_AI_REQUEST_POLICY.transportTimeoutMs);
    });
    try {
      const operation = async () => {
        const response = await this.fetch(this.url, { method: 'POST', body, headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          redirect: 'error', credentials: 'omit', cache: 'no-store', signal: controller.signal });
        const value = await readBoundedJson(response, controller.signal);
        return { response, value };
      };
      const { response, value } = await Promise.race([operation(), timeout]);
      if (this.options.now() - startedAt >= DEFAULT_AI_REQUEST_POLICY.transportTimeoutMs) throw new TransportTimeout();
      if (response.status !== 200) {
        try { this.options.apiVersion === 5 ? parseSummaryError(value, request.requestId, response.status) : this.options.apiVersion === 3 ? parseEventError(value, request.requestId, response.status) : this.options.apiVersion === 2 ? parseBackendMemoryError(value, request.requestId, response.status) : parseBackendError(value, request.requestId, response.status); }
        catch { throw new ProtocolError('Invalid backend error'); }
        const reason = response.status === 504 ? 'timeout' : [429, 503].includes(response.status) ? 'provider_unavailable' : 'unexpected_error';
        return this.fallback(request.requestId, reason, startedAt);
      }
      let result;
      try { result = this.options.apiVersion === 5 ? parseSummaryChatResponse(value, request.requestId, request.userMessage.text) : this.options.apiVersion === 3 ? parseEventAwareChat(value, request.requestId, request.userMessage.text) : this.options.apiVersion === 2 ? parseBackendMemorySuccess(value, request.requestId, request.userMessage.text) : parseBackendSuccess(value, request.requestId); }
      catch { throw new ProtocolError('Invalid backend success'); }
      const decision = result.decision;
      return { requestId: result.requestId, status: 'ok',
        ...('memoryCandidates' in result ? { memoryCandidates: result.memoryCandidates } : {}), reply: { text: result.text, ...(decision?.tone === undefined ? {} : { tone: decision.tone }) },
        suggestedBehavior: decision?.behavior ?? 'respond', confidence: decision?.confidence ?? 1,
        ...(decision?.mood === undefined || decision.mood === 'playful' ? {} : { suggestedMood: decision.mood }),
        diagnostics: { provider: 'external', latencyMs: Math.max(0, this.options.now() - startedAt) } };
    } catch (error) {
      controller.abort();
      if (error instanceof ProtocolError) throw error;
      return this.fallback(request.requestId, error instanceof TransportTimeout ? 'timeout' : 'provider_unavailable', startedAt);
    } finally {
      clearTimeout(timer);
      if (this.chatAbort?.id === request.requestId) this.chatAbort = undefined;
      this.activeRequestId = undefined;
    }
  }
  public cancel(requestId: string): void { if (this.chatAbort?.id === requestId) this.chatAbort.controller.abort(); if (this.eventAbort?.id === requestId) this.eventAbort.controller.abort(); }
  public async generateEvent(request: AIEventProviderRequest): Promise<AIEventProviderResponse> {
    const touch = request.event.type === 'user_touch';
    if (!touch && this.options.apiVersion !== 3 && this.options.apiVersion !== 5) throw new Error('Events unavailable');
    const body = JSON.stringify(touch ? projectTouchRequest(request) : projectEventRequest(request));
    if (this.activeRequestId) throw new Error('Events unavailable');
    const controller = new AbortController(), startedAt = this.options.now();
    this.activeRequestId = request.requestId; this.eventAbort = { id: request.requestId, controller };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutMs = touch ? DEFAULT_AI_REQUEST_POLICY.transportTimeoutMs : 3000;
    const timeout = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new TransportTimeout()); }, timeoutMs); });
    try {
      const url = new URL(this.url); url.pathname = touch ? url.pathname.replace(/v[1235]\/chat$/u, 'v1/touch') : url.pathname.replace(/v[35]\/chat$/u, 'v3/events');
      const operation = async () => {
        const response = await this.fetch(url, { method: 'POST', body, headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, redirect: 'error', credentials: 'omit', cache: 'no-store', signal: controller.signal });
        return { response, value: await readBoundedJson(response, controller.signal) };
      };
      const { response, value } = await Promise.race([operation(), timeout]);
      if (controller.signal.aborted || this.options.now() - startedAt >= timeoutMs) throw new TransportTimeout();
      if (response.status !== 200) {
        touch ? parseBackendError(value, request.requestId, response.status) : parseEventError(value, request.requestId, response.status);
        throw new Error('Event unavailable');
      }
      return touch ? parseTouchResponse(value, request.requestId) : parseEventResponse(value, request.requestId);
    } catch (error) {
      controller.abort(); throw error;
    } finally { clearTimeout(timer); this.eventAbort = undefined; this.activeRequestId = undefined; }
  }
  public async generateSummary(request: Parameters<ISummaryGenerator['generateSummary']>[0], signal: AbortSignal): Promise<string> {
    if (this.options.apiVersion !== 5 || this.activeRequestId || signal.aborted) throw new Error('Summary unavailable');
    const body = JSON.stringify(parseSummaryRequest({ ...request, version: 5, stream: false }));
    const controller = new AbortController(); this.activeRequestId = request.requestId;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rejectAbort: (() => void) | undefined;
    const abort = () => { controller.abort(); rejectAbort?.(); };
    signal.addEventListener('abort', abort, { once: true });
    try {
      const cancelled = new Promise<never>((_resolve, reject) => {
        rejectAbort = () => reject(new TransportTimeout());
        timer = setTimeout(abort, 12000);
      });
      const operation = async () => {
        const url = new URL(this.url); url.pathname = url.pathname.replace(/chat$/u, 'summary');
        const response = await this.fetch(url, { method: 'POST', body, headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, redirect: 'error', credentials: 'omit', cache: 'no-store', signal: controller.signal });
        const value = await readBoundedJson(response, controller.signal);
        if (signal.aborted || controller.signal.aborted) throw new TransportTimeout();
        if (response.status !== 200) { parseSummaryError(value, request.requestId, response.status); throw new ProtocolError('Summary failed'); }
        return parseSummaryResponse(value, request.requestId).text;
      };
      return await Promise.race([operation(), cancelled]);
    } finally { clearTimeout(timer); controller.abort(); signal.removeEventListener('abort', abort); if (this.activeRequestId === request.requestId) this.activeRequestId = undefined; }
  }
  public canStartObservation(): boolean { return this.activeRequestId === undefined; }
  public async generateObservation(request: ObservationProviderRequest, signal: AbortSignal): Promise<string> {
    if (this.activeRequestId || signal.aborted) throw new Error('Observation unavailable');
    const body = JSON.stringify(projectObservationRequest(request));
    const controller = new AbortController(), startedAt = this.options.now();
    this.activeRequestId = request.requestId;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    try {
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new TransportTimeout()); }, 3000);
      });
      const operation = async () => {
        try {
        const url = new URL(this.url); url.pathname = url.pathname.replace(/v[1235]\/chat$/u, 'v6/observation');
        const response = await this.fetch(url, { method: 'POST', body, headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          redirect: 'error', credentials: 'omit', cache: 'no-store', signal: controller.signal });
        const value = await readBoundedJson(response, controller.signal);
        if (controller.signal.aborted || this.options.now() - startedAt >= 3000) throw new TransportTimeout();
        if (response.status !== 200) { parseObservationError(value, request.requestId, response.status); throw new ProtocolError('Observation unavailable'); }
        return parseObservationResponse(value, request.requestId);
        } finally { settled = true; if (this.activeRequestId === request.requestId) this.activeRequestId = undefined; }
      };
      return await Promise.race([operation(), timeout]);
    } finally { clearTimeout(timer); controller.abort(); signal.removeEventListener('abort', abort); if (settled && this.activeRequestId === request.requestId) this.activeRequestId = undefined; }
  }
  private fallback(requestId: string, fallbackReason: AIProviderFallbackReason, startedAt: number): AIProviderResponse {
    return { requestId, status: 'fallback', reply: { text: DIALOGUE_FALLBACK }, confidence: 0,
      diagnostics: { provider: 'external', latencyMs: Math.max(0, this.options.now() - startedAt), fallbackReason } };
  }
}
