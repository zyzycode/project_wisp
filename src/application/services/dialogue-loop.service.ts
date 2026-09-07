import type { DialogueRuntimeOptions } from '../ports/dialogue-runtime';
import type { AIProviderContextMessage, AIProviderRequest, AIProviderResponse } from '../ports/ai-provider.interface';
import type { DialogueCommandReceiptDTO, DialoguePresentationDTO, DialogueFallbackReasonDTO } from '../../shared/ipc-contracts';
import { parseDialogueCommand, parseDialoguePresentation } from '../../shared/dialogue-ipc-validation';
import { parseProviderResponse, parseProviderStatus, fallbackReason, DIALOGUE_FALLBACK } from './dialogue-provider-result';
import { mapProviderResponseToBehaviorIntent } from './provider-response-intent-mapper';

interface Turn { readonly request: AIProviderRequest; readonly generation: number; readonly deadline: number; readonly requestedAtMs: number; }

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
  private turn: DialoguePresentationDTO['turn'] = { phase: 'idle' };
  constructor(private readonly options: DialogueRuntimeOptions) { this.conversationId = options.createId(); }

  public getPresentation(): DialoguePresentationDTO {
    return parseDialoguePresentation({ conversationId: this.conversationId,
      canSubmit: !this.disposed && this.streamId !== null && !this.executing, turn: this.turn });
  }
  public replaceStream(streamId: string): void {
    if (this.disposed) return;
    this.options.transaction(() => { this.reset(); this.streamId = streamId; this.sequence = 0; this.options.publish(); });
  }
  public detachStream(): void {
    if (this.disposed) return;
    this.options.transaction(() => { this.reset(); this.streamId = null; });
  }
  public dispose(): void { this.detachStream(); this.disposed = true; }
  public receive(payload: unknown): DialogueCommandReceiptDTO {
    let command;
    try { command = parseDialogueCommand(payload); } catch { return { status: 'rejected', reason: 'invalid_input' }; }
    if (this.disposed || this.streamId === null) return { status: 'rejected', reason: 'unavailable' };
    if (command.streamId !== this.streamId || command.conversationId !== this.conversationId || command.sequence <= this.sequence) return { status: 'rejected', reason: 'stale' };
    this.sequence = command.sequence;
    if (command.type === 'reset') {
      this.options.transaction(() => { this.reset(); this.options.publish(); });
      return { status: 'accepted', conversationId: this.conversationId };
    }
    if (this.executing) return { status: 'rejected', reason: 'busy' };
    const requestId = this.options.createId();
    const createdAt = this.options.timestamp();
    const requestedAtMs = this.options.now();
    const deadline = requestedAtMs + 15000;
    this.executing = true;
    this.options.transaction(() => {
      this.options.applyStimulus({ type: 'user_message', source: 'user', requestId, text: command.text, createdAt });
      const request: AIProviderRequest = { requestId, userMessage: { id: this.options.createId(), text: command.text, createdAt },
        characterSnapshot: this.options.getCharacterSnapshot(), recentContext: this.context.map(message => ({ ...message })), locale: this.options.locale ?? 'ru' };
      const active: Turn = { request, generation: this.generation, deadline, requestedAtMs };
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
    this.active = null; this.context = []; this.turn = { phase: 'idle' }; this.conversationId = this.options.createId();
  }
  private cancelTimer(): void {
    if (this.timer !== undefined) this.options.scheduler.clearTimeout(this.timer);
    this.timer = undefined;
  }
  private isCurrent(turn: Turn): boolean { return !this.disposed && this.active === turn && this.generation === turn.generation && this.streamId !== null; }
  private mayContinue(turn: Turn): boolean {
    if (!this.isCurrent(turn)) return false;
    if (this.options.now() >= turn.deadline) { this.finish(turn, 'timeout'); return false; }
    return true;
  }
  private async execute(turn: Turn): Promise<void> {
    try {
      if (!this.mayContinue(turn)) return;
      const rawStatus = await this.options.provider.getStatus();
      if (!this.mayContinue(turn)) return;
      const status = parseProviderStatus(rawStatus);
      if (status.kind === 'offline') { this.executing = false; this.finish(turn, 'offline'); return; }
      if (status.kind !== 'ready' && status.kind !== 'degraded') { this.executing = false; this.finish(turn, 'provider_error'); return; }
      const rawResponse = await this.options.provider.generateResponse(turn.request);
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
      if (!this.disposed && this.streamId !== null) this.options.transaction(() => this.options.publish());
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
      this.context = [...this.context, ...pair].slice(-6);
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
    });
  }
}
