import type { InteractionReceipt } from '../ports/interaction-appraisal';
import { emptyMemoryContext } from './memory-recall';
import { boundMemoryContext } from './memory-context';
import type { DialogueRuntimeOptions } from '../ports/dialogue-runtime';
import type { AIProviderContextMessage, AIProviderRequest, AIProviderResponse } from '../ports/ai-provider.interface';
import type { DialogueCommandReceiptDTO, DialoguePresentationDTO, DialogueFallbackReasonDTO } from '../../shared/ipc-contracts';
import { parseDialogueCommand, parseDialoguePresentation } from '../../shared/dialogue-ipc-validation';
import { parseProviderResponse, parseProviderStatus, fallbackReason, DIALOGUE_FALLBACK } from './dialogue-provider-result';
import { mapProviderResponseToBehaviorIntent } from './provider-response-intent-mapper';

interface Turn { readonly request: AIProviderRequest; readonly generation: number; readonly deadline: number; readonly requestedAtMs: number; readonly memoryGeneration: number; readonly interactionReceipt?: InteractionReceipt; }

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
  public getIdentity(): string | null { return this.streamId === null || this.disposed ? null : `${this.streamId}:${this.conversationId}:${this.generation}`; }
  public getPresentation(): DialoguePresentationDTO {
    return parseDialoguePresentation({ conversationId: this.conversationId,
      canSubmit: !this.disposed && this.streamId !== null && !this.executing, turn: this.turn });
  }
  public replaceStream(streamId: string): void {
    if (this.disposed) return;
    this.options.transaction(() => { if (this.hasStartedStream) this.hydrationAllowed = false; this.reset(); if (!this.hasStartedStream && this.initialContext) this.context = [...this.initialContext]; this.initialContext = null; this.hasStartedStream = true; this.streamId = streamId; this.sequence = 0; this.options.publish(); });
  }
  public detachStream(): void {
    if (this.disposed) return;
    this.options.transaction(() => { if (this.hasStartedStream) this.hydrationAllowed = false; this.reset(); this.streamId = null; });
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
    this.options.summary?.interrupt();
    if (this.executing) return { status: 'rejected', reason: 'busy' };
    this.options.observation?.invalidate();
    const previousTouch = this.options.interactionEnabled ? this.options.events?.getPreviousTouch?.() : undefined;
    const previousInitiative = this.options.events?.takePreviousInitiative();
    const requestId = this.options.createId();
    const createdAt = this.options.timestamp();
    const requestedAtMs = this.options.now();
    const deadline = requestedAtMs + 15000;
    this.executing = true;
    this.options.transaction(() => {
      const interactionReceipt = this.options.beginInteraction?.();
      if (!interactionReceipt) this.options.applyStimulus({ type: 'user_message', source: 'user', requestId, text: command.text, createdAt });
      const request: AIProviderRequest = { ...(this.options.interactionEnabled ? { interaction: { card: { id: 'shyDreamGirl', revision: 1 }, effectPolicy: interactionReceipt?.effectPolicy ?? 'suppressed', ...(previousTouch ? { previousTouch } : {}) } } : {}), requestId, ...(previousInitiative ? { previousInitiative } : {}), userMessage: { id: this.options.createId(), text: command.text, createdAt },
        characterSnapshot: this.options.getCharacterSnapshot(), recentContext: this.context.map(message => ({ ...message })), locale: this.options.locale ?? 'ru' };
      const active: Turn = { ...(interactionReceipt ? { interactionReceipt } : {}), request, generation: this.generation, deadline, requestedAtMs, memoryGeneration: this.options.memory?.generation() ?? 0 };
      this.active = active; this.turn = { phase: 'thinking', requestId };
      this.timer = this.options.scheduler.setTimeout(() => this.finish(active, 'timeout'), Math.max(0, deadline - this.options.now()));
      this.options.setBehaviorContext?.({ requestId, conversationId: this.conversationId, generation: this.generation, requestedAtMs });
      this.options.beginThinking(requestId); this.options.publish();
      void Promise.resolve().then(() => this.execute(active));
    });
    return { status: 'accepted', conversationId: this.conversationId };
  }
  private reset(): void {
    this.options.observation?.reset();
    this.options.events?.invalidate();
    this.options.summary?.interrupt();
    this.generation++; this.cancelTimer();
    this.options.setBehaviorContext?.(null);
    if (this.active) { this.options.provider.cancel?.(this.active.request.requestId); this.options.endThinking(this.active.request.requestId); }
    this.active = null; this.context = []; this.contextMessageIds = []; this.turn = { phase: 'idle' }; this.conversationId = this.options.createId();
  }
  private cancelTimer(): void {
    if (this.timer !== undefined) this.options.scheduler.clearTimeout(this.timer);
    this.timer = undefined;
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
      await this.options.observation?.interruptForUser();
      if (!this.mayContinue(turn)) return;
      await this.options.events?.interruptForUser();
      if (!this.mayContinue(turn)) return;
      let request = turn.request;
      const summary = this.options.summary ? await this.options.summary.capture(request.userMessage.text) : undefined;
      if (!this.mayContinue(turn)) return;
      if (this.options.memory?.recall) {
        const recalled = await this.options.memory.recall.recall({ text: request.userMessage.text, excludedMessageIds: [...this.contextMessageIds, ...(summary?.excludedMessageIds ?? [])] }, { generation: turn.memoryGeneration });
        if (!this.mayContinue(turn)) return;
        request = { ...request, memoryContext: recalled.ok ? recalled.value : emptyMemoryContext() };
      }
      const rawStatus = await this.options.provider.getStatus();
      if (!this.mayContinue(turn)) return;
      const status = parseProviderStatus(rawStatus);
      if (status.kind === 'offline') { this.executing = false; this.finish(turn, 'offline'); return; }
      if (status.kind !== 'ready' && status.kind !== 'degraded') { this.executing = false; this.finish(turn, 'provider_error'); return; }
      if (summary) {
        if (!this.options.summary?.isCurrent(summary)) request = { ...request, memoryContext: emptyMemoryContext() };
        else {
          const withSummary = { ...request, summary: { text: summary.text } };
          if (this.options.provider.canIncludeSummary?.(withSummary) !== false) request = withSummary;
          else if (this.options.memory?.recall) {
            const recalled = await this.options.memory.recall.recall({ text: request.userMessage.text, excludedMessageIds: [...this.contextMessageIds] }, { generation: turn.memoryGeneration });
            if (!this.mayContinue(turn)) return;
            request = { ...request, memoryContext: recalled.ok && this.options.summary.isCurrent(summary) ? recalled.value : emptyMemoryContext() };
          }
        }
      }
      if (request.interaction) {
        const previousTouch = this.options.events?.getPreviousTouch?.();
        request = { ...request, interaction: { card: request.interaction.card, effectPolicy: request.interaction.effectPolicy, ...(previousTouch ? { previousTouch } : {}) } };
      }
      const responsePromise = this.options.provider.generateResponse(request);
      this.options.transaction(() => { this.options.publish(); });
      const rawResponse = await responsePromise;
      this.executing = false;
      if (!this.mayContinue(turn)) return;
      let response: AIProviderResponse;
      try { response = parseProviderResponse(rawResponse, turn.request.requestId); if (this.options.interactionEnabled && response.status === 'ok' && (!response.appraisal || (turn.request.interaction?.effectPolicy === 'suppressed' && (response.appraisal.category !== 'neutral' || response.appraisal.intensity !== 'low' || response.appraisal.confidence !== 'clear')))) throw new TypeError('Invalid suppressed appraisal'); if (!this.options.interactionEnabled && response.appraisal) throw new TypeError('Unexpected appraisal'); }
      catch { this.finish(turn, 'invalid_response'); return; }
      this.finish(turn, response.status === 'fallback' ? fallbackReason(response) : undefined, response);
    } catch {
      this.executing = false;
      if (this.mayContinue(turn)) this.finish(turn, 'provider_error');
    } finally {
      this.executing = false;
      if (!this.disposed && this.streamId !== null) this.options.transaction(() => { this.options.publish(); });
    }
  }
  private finish(active: Turn, reason?: DialogueFallbackReasonDTO, response?: AIProviderResponse): void {
    if (!this.isCurrent(active)) return;
    if (this.options.now() >= active.deadline) { reason = 'timeout'; response = undefined; }
    this.active = null; this.cancelTimer();
    this.options.transaction(() => {
      const requestId = active.request.requestId;
      if (active.interactionReceipt && this.options.commitInteraction) {
        const outcome = this.options.commitInteraction(active.interactionReceipt, reason === undefined && this.options.interactionEnabled ? response?.appraisal : undefined);
        if (reason === undefined && this.options.interactionEnabled && (outcome.effect === 'rejected' || outcome.effect === 'suppressed')) { reason = 'degraded'; response = undefined; }
      }
      this.options.endThinking(requestId);
      const replyText = response?.reply.text ?? DIALOGUE_FALLBACK;
      const assistantId = this.options.createId();
      let presentation: DialoguePresentationDTO;
      try {
        presentation = parseDialoguePresentation({ conversationId: this.conversationId, canSubmit: false,
          turn: { phase: 'completed', requestId, replyText, ...(reason === undefined ? { memorySource: { userMessageId: active.request.userMessage.id, assistantMessageId: assistantId } } : {}), outcome: reason === undefined ? { kind: 'success' } : { kind: 'fallback', reason } } });
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
      this.contextMessageIds = [...this.contextMessageIds, active.request.userMessage.id, assistantId].slice(-this.context.length);
      this.options.memory?.completed({ user: active.request.userMessage,
        assistant: { id: assistantId, text: replyText, createdAt }, memoryConfirmable: reason === undefined, memoryGeneration: active.memoryGeneration });
    });
  }
}
