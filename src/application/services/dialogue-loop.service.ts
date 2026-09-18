import { emptyMemoryContext } from './memory-recall';
import { boundMemoryContext } from './memory-context';
import type { DialogueRuntimeOptions } from '../ports/dialogue-runtime';
import type { AIProviderContextMessage, AIProviderRequest, AIProviderResponse } from '../ports/ai-provider.interface';
import type { DialogueCommandReceiptDTO, DialoguePresentationDTO, DialogueFallbackReasonDTO } from '../../shared/ipc-contracts';
import { parseDialogueCommand, parseDialoguePresentation } from '../../shared/dialogue-ipc-validation';
import { parseProviderResponse, parseProviderStatus, fallbackReason, DIALOGUE_FALLBACK } from './dialogue-provider-result';
import { mapProviderResponseToBehaviorIntent } from './provider-response-intent-mapper';

interface Turn { readonly request: AIProviderRequest; readonly generation: number; readonly deadline: number; readonly requestedAtMs: number; readonly memoryGeneration: number; }

/** One instance per Main lifecycle, including while its window is closed. */
export class DialogueRuntime {
  private streamId: string | null = null;
  private conversationId: string;
  private sequence = 0;
  private generation = 0;
  private disposed = false;
  private executing = false;
  private active: Turn | null = null;
  private timer: unknown;
  private availabilityTimer: unknown;
  private context: AIProviderContextMessage[] = [];
  private contextMessageIds: string[] = [];
  private initialContext: readonly AIProviderContextMessage[] | null = null;
  private hasStartedStream = false;
  private hydrationAllowed = true;
  private turn: DialoguePresentationDTO['turn'] = { phase: 'idle' };
  constructor(private readonly options: DialogueRuntimeOptions) { this.conversationId = options.createId(); }

  public hydrateInitialContext(messages: readonly AIProviderContextMessage[]): void {
    if (!this.hydrationAllowed || !this.options.memory?.contextLimits || this.disposed) return;
    this.initialContext = boundMemoryContext(messages, this.options.memory.contextLimits);
    if (this.hasStartedStream) { this.context = [...this.initialContext]; this.initialContext = null; }
  }
  public cancelForMemoryReset(): void { const context = this.context; const messageIds = this.contextMessageIds; this.options.transaction(() => { this.reset(); this.context = context; this.contextMessageIds = messageIds; this.options.publish(); }); }
  public clearMemoryContext(): void { this.hydrationAllowed = false; this.initialContext = null; this.options.transaction(() => { this.reset(); this.options.publish(); }); }
  public getPresentation(): DialoguePresentationDTO {
    const availability = this.options.requestControl?.availability(this.options.now());
    const submissionMessage = availability && !availability.available
      ? availability.reason === 'budget_exhausted'
        ? 'Лимит сообщений на этот запуск исчерпан. Новый диалог станет доступен после перезапуска приложения.'
        : 'Подожди немного перед следующим сообщением.'
      : undefined;
    return parseDialoguePresentation({ conversationId: this.conversationId,
      canSubmit: !this.disposed && this.streamId !== null && !this.executing && (availability?.available ?? true),
      ...(submissionMessage === undefined ? {} : { submissionMessage }), turn: this.turn });
  }
  public replaceStream(streamId: string): void {
    if (this.disposed) return;
    this.options.transaction(() => { if (this.hasStartedStream) this.hydrationAllowed = false; this.reset(); if (!this.hasStartedStream && this.initialContext) this.context = [...this.initialContext]; this.initialContext = null; this.hasStartedStream = true; this.streamId = streamId; this.sequence = 0; this.refreshAvailability(); this.options.publish(); });
  }
  public detachStream(): void {
    if (this.disposed) return;
    this.options.transaction(() => { if (this.hasStartedStream) this.hydrationAllowed = false; this.reset(); this.streamId = null; this.clearAvailabilityTimer(); });
  }
  public dispose(): void { this.detachStream(); this.disposed = true; }
  public receive(payload: unknown): DialogueCommandReceiptDTO {
    let command;
    try { command = parseDialogueCommand(payload); } catch { return { status: 'rejected', reason: 'invalid_input' }; }
    if (this.disposed || this.streamId === null) return { status: 'rejected', reason: 'unavailable' };
    if (command.streamId !== this.streamId || command.conversationId !== this.conversationId || command.sequence <= this.sequence) return { status: 'rejected', reason: 'stale' };
    this.sequence = command.sequence; this.hydrationAllowed = false; this.initialContext = null;
    if (command.type === 'reset') {
      this.options.transaction(() => { this.reset(); this.options.publish(); });
      return { status: 'accepted', conversationId: this.conversationId };
    }
    if (this.executing) return { status: 'rejected', reason: 'busy' };
    if (!this.canRequest()) {
      this.options.transaction(() => {
        this.refreshAvailability(); this.options.publish();
      });
      return { status: 'rejected', reason: 'unavailable' };
    }
    const requestId = this.options.createId();
    const createdAt = this.options.timestamp();
    const requestedAtMs = this.options.now();
    const deadline = requestedAtMs + 15000;
    this.executing = true;
    this.options.transaction(() => {
      this.options.applyStimulus({ type: 'user_message', source: 'user', requestId, text: command.text, createdAt });
      const request: AIProviderRequest = { requestId, userMessage: { id: this.options.createId(), text: command.text, createdAt },
        characterSnapshot: this.options.getCharacterSnapshot(), recentContext: this.context.map(message => ({ ...message })), locale: this.options.locale ?? 'ru' };
      const active: Turn = { request, generation: this.generation, deadline, requestedAtMs, memoryGeneration: this.options.memory?.generation() ?? 0 };
      this.active = active; this.turn = { phase: 'thinking', requestId };
      this.timer = this.options.scheduler.setTimeout(() => this.finish(active, 'timeout'), Math.max(0, deadline - this.options.now()));
      this.options.setBehaviorContext?.({ requestId, conversationId: this.conversationId, generation: this.generation, requestedAtMs });
      this.options.beginThinking(requestId); this.options.publish();
      void Promise.resolve().then(() => this.execute(active));
    });
    return { status: 'accepted', conversationId: this.conversationId };
  }
  private reset(): void {
    this.generation++; this.cancelTimer();
    this.options.setBehaviorContext?.(null);
    if (this.active) this.options.endThinking(this.active.request.requestId);
    this.active = null; this.context = []; this.contextMessageIds = []; this.turn = { phase: 'idle' }; this.conversationId = this.options.createId();
  }
  private cancelTimer(): void {
    if (this.timer !== undefined) this.options.scheduler.clearTimeout(this.timer);
    this.timer = undefined;
  }
  private canRequest(): boolean { return this.options.requestControl?.availability(this.options.now()).available ?? true; }
  private clearAvailabilityTimer(): void {
    if (this.availabilityTimer !== undefined) this.options.scheduler.clearTimeout(this.availabilityTimer);
    this.availabilityTimer = undefined;
  }
  private refreshAvailability(): void {
    this.clearAvailabilityTimer();
    const availability = this.options.requestControl?.availability(this.options.now());
    if (this.disposed || this.streamId === null || !availability || availability.available || availability.retryAtMs === undefined) return;
    this.availabilityTimer = this.options.scheduler.setTimeout(() => {
      this.availabilityTimer = undefined;
      if (!this.disposed && this.streamId !== null) this.options.transaction(() => { this.refreshAvailability(); this.options.publish(); });
    }, Math.max(0, availability.retryAtMs - this.options.now()));
  }
  private isCurrent(turn: Turn): boolean { return !this.disposed && this.active === turn && this.generation === turn.generation && this.streamId !== null; }
  private mayContinue(turn: Turn): boolean {
    if (!this.isCurrent(turn)) return false;
    if (this.options.memory && this.options.memory.generation() !== turn.memoryGeneration) {
      this.options.transaction(() => { this.reset(); this.options.publish(); }); return false;
    }
    if (this.options.now() >= turn.deadline) { this.finish(turn, 'timeout'); return false; }
    return true;
  }
  private async execute(turn: Turn): Promise<void> {
    try {
      if (!this.mayContinue(turn)) return;
      let request = turn.request;
      if (this.options.memory?.recall) {
        const recalled = await this.options.memory.recall.recall({ text: request.userMessage.text, excludedMessageIds: [...this.contextMessageIds] }, { generation: turn.memoryGeneration });
        if (!this.mayContinue(turn)) return;
        request = { ...request, memoryContext: recalled.ok ? recalled.value : emptyMemoryContext() };
      }
      const rawStatus = await this.options.provider.getStatus();
      if (!this.mayContinue(turn)) return;
      const status = parseProviderStatus(rawStatus);
      if (status.kind === 'offline') { this.executing = false; this.finish(turn, 'offline'); return; }
      if (status.kind !== 'ready' && status.kind !== 'degraded') { this.executing = false; this.finish(turn, 'provider_error'); return; }
      const responsePromise = this.options.provider.generateResponse(request);
      // The adapter records actual submission before yielding its response promise.
      this.options.transaction(() => { this.refreshAvailability(); this.options.publish(); });
      const rawResponse = await responsePromise;
      this.executing = false;
      if (!this.mayContinue(turn)) return;
      let response: AIProviderResponse;
      try { response = parseProviderResponse(rawResponse, turn.request.requestId); }
      catch { this.finish(turn, 'invalid_response'); return; }
      this.finish(turn, response.status === 'fallback' ? fallbackReason(response) : undefined, response);
    } catch {
      this.executing = false;
      if (this.mayContinue(turn)) this.finish(turn, 'provider_error');
    } finally {
      this.executing = false;
      if (!this.disposed && this.streamId !== null) this.options.transaction(() => { this.refreshAvailability(); this.options.publish(); });
    }
  }
  private finish(active: Turn, reason?: DialogueFallbackReasonDTO, response?: AIProviderResponse): void {
    if (!this.isCurrent(active)) return;
    if (this.options.now() >= active.deadline) { reason = 'timeout'; response = undefined; }
    this.active = null; this.cancelTimer();
    this.options.transaction(() => {
      const requestId = active.request.requestId;
      this.options.endThinking(requestId);
      const replyText = response?.reply.text ?? DIALOGUE_FALLBACK;
      let presentation: DialoguePresentationDTO;
      try {
        presentation = parseDialoguePresentation({ conversationId: this.conversationId, canSubmit: false,
          turn: { phase: 'completed', requestId, replyText, outcome: reason === undefined ? { kind: 'success' } : { kind: 'fallback', reason } } });
      } catch {
        this.turn = { phase: 'error', requestId, message: 'Не удалось показать ответ. Попробуй позже.' };
        this.options.publish(); return;
      }
      this.turn = presentation.turn;
      const createdAt = this.options.timestamp();
      const pair: AIProviderContextMessage[] = [{ role: 'user', text: active.request.userMessage.text, createdAt: active.request.userMessage.createdAt }, { role: 'wisp', text: replyText, createdAt }];
      this.context = this.options.memory?.contextLimits ? boundMemoryContext([...this.context, ...pair], this.options.memory.contextLimits) : [...this.context, ...pair].slice(-6);
      if (reason === undefined && response) {
        const tone = response.reply.tone;
        this.options.applyStimulus({ type: 'provider_response', source: 'provider', text: replyText, requestId, createdAt,
          metadata: { tone: tone === 'warm' ? 'affectionate' : tone === 'confused' || tone === 'quiet' ? 'neutral' : tone ?? null } });
        if (response.suggestedBehavior !== undefined) {
          const intent = mapProviderResponseToBehaviorIntent(response);
          this.options.offerIntent({ intent: { ...intent, source: 'provider', requestId },
            conversationId: this.conversationId, generation: active.generation,
            requestedAtMs: active.requestedAtMs, receivedAtMs: this.options.now(), expiresAtMs: active.requestedAtMs + 30000 });
        }
      }
      this.options.publish();
      const assistantId = this.options.createId();
      this.contextMessageIds = [...this.contextMessageIds, active.request.userMessage.id, assistantId].slice(-this.context.length);
      this.options.memory?.completed({ user: active.request.userMessage,
        assistant: { id: assistantId, text: replyText, createdAt }, memoryGeneration: active.memoryGeneration });
    });
  }
}
