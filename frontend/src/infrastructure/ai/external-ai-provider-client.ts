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
}
class ProtocolError extends Error {}
class TransportTimeout extends Error {}
function boundedCancellation(signal: AbortSignal) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectCancellation: (() => void) | undefined;
  const promise = new Promise<never>((_resolve, reject) => { rejectCancellation = () => reject(new TransportTimeout()); });
  const abort = () => { timer = setTimeout(() => rejectCancellation?.(), 3000); };
  signal.addEventListener('abort', abort, { once: true });
  return { promise, dispose: () => { clearTimeout(timer); signal.removeEventListener('abort', abort); } };
}

/** Trusted Main configuration only; redirects, cookies and provider secrets are forbidden. */
function endpoint(baseUrl: string, development: boolean, operation: 'chat' | 'touch' | 'events' | 'summary' | 'observation'): URL {
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
  private chatAbort: { id: string; controller: AbortController } | undefined;
  private eventAbort: { id: string; controller: AbortController } | undefined;
  private readonly urls: Readonly<Record<'chat' | 'touch' | 'events' | 'summary' | 'observation', URL>>;
  private readonly fetch: typeof fetch;
  private activeRequestId: string | undefined;
  constructor(private readonly options: ExternalAIProviderOptions) {
    this.urls = { chat: endpoint(options.baseUrl, options.development, 'chat'), touch: endpoint(options.baseUrl, options.development, 'touch'), events: endpoint(options.baseUrl, options.development, 'events'), summary: endpoint(options.baseUrl, options.development, 'summary'), observation: endpoint(options.baseUrl, options.development, 'observation') };
    this.fetch = options.fetch ?? globalThis.fetch;
  }
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
    if (this.activeRequestId) throw new Error('Transport unavailable');
    const startedAt = this.options.now();
    const controller = new AbortController();
    const cancellation = boundedCancellation(controller.signal);
    let settled = false, completed = false;
    this.chatAbort = { id: request.requestId, controller };
    this.activeRequestId = request.requestId;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { reject(new TransportTimeout()); controller.abort(); }, DEFAULT_AI_REQUEST_POLICY.transportTimeoutMs);
    });
    try {
      const operation = async () => {
        try {
        const response = await this.fetch(this.urls.chat, { method: 'POST', body, headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          redirect: 'error', credentials: 'omit', cache: 'no-store', signal: controller.signal });
        const value = await readBoundedJson(response, controller.signal);
        return { response, value };
        } finally { settled = true; if (completed && this.activeRequestId === request.requestId) this.activeRequestId = undefined; }
      };
      const { response, value } = await Promise.race([operation(), timeout, cancellation.promise]);
      if (controller.signal.aborted || this.options.now() - startedAt >= DEFAULT_AI_REQUEST_POLICY.transportTimeoutMs) throw new TransportTimeout();
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
    } catch (error) {
      controller.abort();
      if (error instanceof ProtocolError) throw error;
      return this.fallback(request.requestId, error instanceof TransportTimeout ? 'timeout' : 'provider_unavailable', startedAt);
    } finally {
      completed = true;
      clearTimeout(timer);
      cancellation.dispose();
      if (this.chatAbort?.id === request.requestId) this.chatAbort = undefined;
      if (settled && this.activeRequestId === request.requestId) this.activeRequestId = undefined;
    }
  }
  public cancel(requestId: string): void { if (this.chatAbort?.id === requestId) this.chatAbort.controller.abort(); if (this.eventAbort?.id === requestId) this.eventAbort.controller.abort(); }
  public async generateEvent(request: AIEventProviderRequest): Promise<AIEventProviderResponse> {
    const touch = request.event.type === 'user_touch';
    const projected = touch ? projectInteractionTouch(request) : projectEventRequest(request);
    const body = JSON.stringify(projected);
    if (this.activeRequestId) throw new Error('Events unavailable');
    const controller = new AbortController(), startedAt = this.options.now();
    const cancellation = boundedCancellation(controller.signal);
    let settled = false, completed = false;
    this.activeRequestId = request.requestId; this.eventAbort = { id: request.requestId, controller };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutMs = touch ? DEFAULT_AI_REQUEST_POLICY.transportTimeoutMs : 3000;
    const timeout = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new TransportTimeout()); }, timeoutMs); });
    try {
      const url = touch ? this.urls.touch : this.urls.events;
      const operation = async () => {
        try {
        const response = await this.fetch(url, { method: 'POST', body, headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, redirect: 'error', credentials: 'omit', cache: 'no-store', signal: controller.signal });
        return { response, value: await readBoundedJson(response, controller.signal) };
        } finally { settled = true; if (completed && this.activeRequestId === request.requestId) this.activeRequestId = undefined; }
      };
      const { response, value } = await Promise.race([operation(), timeout, cancellation.promise]);
      if (controller.signal.aborted || this.options.now() - startedAt >= timeoutMs) throw new TransportTimeout();
      if (response.status !== 200) {
        touch ? parseInteractionError(value, request.requestId, response.status) : parseEventError(value, request.requestId, response.status);
        throw new Error('Event unavailable');
      }
      return touch ? parseInteractionTouchResponse(value, request.requestId, 'effectPolicy' in projected ? projected.effectPolicy : 'suppressed') : parseEventResponse(value, request.requestId);
    } catch (error) {
      controller.abort(); throw error;
    } finally { completed = true; clearTimeout(timer); cancellation.dispose(); this.eventAbort = undefined; if (settled && this.activeRequestId === request.requestId) this.activeRequestId = undefined; }
  }
  public async generateSummary(request: Parameters<ISummaryGenerator['generateSummary']>[0], signal: AbortSignal): Promise<string> {
    if (this.activeRequestId || signal.aborted) throw new Error('Summary unavailable');
    const body = JSON.stringify(parseSummaryRequest({ ...request, stream: false }));
    const controller = new AbortController(); this.activeRequestId = request.requestId;
    let settled = false, completed = false;
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
        try {
        const url = this.urls.summary;
        const response = await this.fetch(url, { method: 'POST', body, headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, redirect: 'error', credentials: 'omit', cache: 'no-store', signal: controller.signal });
        const value = await readBoundedJson(response, controller.signal);
        if (signal.aborted || controller.signal.aborted) throw new TransportTimeout();
        if (response.status !== 200) { parseSummaryError(value, request.requestId, response.status); throw new ProtocolError('Summary failed'); }
        return parseSummaryResponse(value, request.requestId).text;
        } finally { settled = true; if (completed && this.activeRequestId === request.requestId) this.activeRequestId = undefined; }
      };
      return await Promise.race([operation(), cancelled]);
    } finally { completed = true; clearTimeout(timer); controller.abort(); signal.removeEventListener('abort', abort); if (settled && this.activeRequestId === request.requestId) this.activeRequestId = undefined; }
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
        const url = this.urls.observation;
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
