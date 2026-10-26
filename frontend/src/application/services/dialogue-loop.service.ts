import { recognizeBeverageCorrection } from './beverage-preference';
import type { BeverageCapture, BeverageCorrectionTurn } from '../ports/memory-beverage.interface';
import { parseBeverageProposal } from '../../shared/beverage-validation';
import { isQuietSupportCue, LOCAL_DIALOGUE_TEXT } from './quiet-support-runtime';
import { isTopicRefusal } from './interest-thread';
import { DialogueAdmission } from './dialogue-admission';
import type { InterestThreadCapture, InterestThreadRef } from '../ports/interest-thread.interface';
import type { InteractionReceipt } from '../ports/interaction-appraisal';
import { emptyMemoryContext } from './memory-recall';
import { boundMemoryContext } from './memory-context';
import type { DialogueRuntimeOptions } from '../ports/dialogue-runtime';
import type { AIProviderContextMessage, AIProviderRequest, AIProviderResponse } from '../ports/ai-provider.interface';
import type { DialogueCommandReceiptDTO, DialoguePresentationDTO, DialogueFallbackReasonDTO } from '../../shared/ipc-contracts';
import { parseDialogueCommand, parseDialoguePresentation } from '../../shared/dialogue-ipc-validation';
import { parseProviderResponse, parseProviderStatus, fallbackReason, DIALOGUE_FALLBACK } from './dialogue-provider-result';
import { mapProviderResponseToBehaviorIntent } from './provider-response-intent-mapper';

interface Turn { readonly request: AIProviderRequest; readonly generation: number; readonly deadline: number; readonly requestedAtMs: number; readonly memoryGeneration: number; readonly interactionReceipt?: InteractionReceipt; readonly admissionDeadline: number; readonly replyTo?: InterestThreadRef; readonly requestBeverageProposal?: true; readonly beverageCorrection?: Omit<BeverageCorrectionTurn, 'requestId' | 'userMessageId'>; }

/** One instance per Main lifecycle, including while its window is closed. */
export class DialogueRuntime {
  private readonly admission: DialogueAdmission;
  private pending: object | null = null;
  private lastOffered: InterestThreadRef | undefined;
  private sourceUserText: string | null = null;
  private supportEligible = false;
  private readonly beverageCaptures = new WeakMap<Turn, BeverageCapture>();
  private readonly dispatchedBeverage = new WeakSet<Turn>();
  private readonly captures = new WeakMap<Turn, InterestThreadCapture>();
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
  constructor(private readonly options: DialogueRuntimeOptions) { this.conversationId = options.createId(); this.admission = new DialogueAdmission(options.now, options.scheduler); }

  public hydrateInitialContext(messages: readonly AIProviderContextMessage[]): void {
    if (!this.hydrationAllowed || !this.options.memory?.contextLimits || this.disposed) return;
    this.initialContext = boundMemoryContext(messages, this.options.memory.contextLimits);
    if (this.hasStartedStream) { this.context = [...this.initialContext]; this.initialContext = null; }
  }
  public cancelForMemoryReset(): void { this.options.quietSupport?.resetMemory(); const context = this.context; const messageIds = this.contextMessageIds; this.options.transaction(() => { this.reset(); this.context = context; this.contextMessageIds = messageIds; this.options.publish(); }); }
  public clearMemoryContext(admissionToken?: object): void { const own = admissionToken !== undefined && this.pending === admissionToken; const pending = own ? this.pending : null; this.hydrationAllowed = false; this.initialContext = null; this.options.transaction(() => { this.reset(); if (own) { this.pending = pending; this.executing = true; } this.options.publish(); }); }
  public isTopicRequestCurrent(requestId: string): boolean { return this.active !== null && this.active.request.requestId === requestId && this.isCurrent(this.active); }
  public isAdmissionCurrent(token: object): boolean { return !this.disposed && this.streamId !== null && this.pending === token; }
  public confirmableSource(source: { userMessageId: string; assistantMessageId: string }, conversationId: string): string | null {
    const turn = this.turn;
    return conversationId === this.conversationId && turn.phase === 'completed' && turn.outcome.kind === 'success' && turn.memorySource?.userMessageId === source.userMessageId && turn.memorySource.assistantMessageId === source.assistantMessageId ? this.sourceUserText : null;
  }
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
  public dispose(): void { this.detachStream(); this.options.quietSupport?.dispose(); this.disposed = true; }
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
    this.options.memory?.beverage?.invalidateOffer();
    this.options.quietSupport?.resumeForUserDialogue();
    if (!command.replyToInterestThread && this.supportEligible && isQuietSupportCue(command.text) && this.options.quietSupport) {
      this.acknowledgeSupport(command.text);
      return { status: 'accepted', conversationId: this.conversationId };
    }
    this.supportEligible = false;
    const requestedAtMs = this.options.now();
    const deadline = requestedAtMs + 15000;
    const admissionDeadline = requestedAtMs + 200;
    if (this.options.memory?.interestThread || this.options.memory?.beverage) {
      const token = {}; this.pending = token; this.executing = true; this.options.publish();
      const correctionSensitive = !!this.options.memory?.beverage && !command.replyToInterestThread && recognizeBeverageCorrection(command.text) !== null;
      const scopedRefusal = !!(command.replyToInterestThread || this.lastOffered) && isTopicRefusal(command.text);
      const memoryGeneration = this.options.memory.generation();
      void this.admission.run(admissionDeadline, async (): Promise<import('../ports/memory-repository.interface').MemoryResult<{ kind: 'continue' | 'closed'; generation: number; correction?: Omit<BeverageCorrectionTurn, 'requestId' | 'userMessageId'> }>> => {
        const topic = this.options.memory?.interestThread ? await this.options.memory.interestThread.admit({ text: command.text,
          ...(command.replyToInterestThread ? { replyTo: command.replyToInterestThread } : {}), ...(this.lastOffered ? { lastOffered: this.lastOffered } : {}), deadlineMs: admissionDeadline, admissionToken: token }, { generation: memoryGeneration }) : { ok: true as const, value: { kind: 'continue' as const, generation: memoryGeneration } };
        if (!topic.ok || topic.value.kind === 'closed') return topic;
        const beverage = this.options.memory?.beverage ? await this.options.memory.beverage.admit({ text: command.text, replyToTopic: !!command.replyToInterestThread, deadlineMs: admissionDeadline, admissionToken: token }, { generation: topic.value.generation }) : { ok: true as const, value: { generation: topic.value.generation } };
        return beverage.ok ? { ok: true as const, value: { kind: 'continue' as const, ...beverage.value } } : beverage;
      })
        .then(result => {
          if (this.pending !== token || this.disposed || this.streamId === null) return;
          if (result?.ok && result.value.generation !== this.options.memory?.generation()) { this.pending = null; this.executing = false; this.options.publish(); return; }
          this.pending = null; this.executing = false;
          if ((correctionSensitive && result?.ok !== true) || scopedRefusal || (result?.ok && result.value.kind === 'closed')) { if (correctionSensitive && result?.ok !== true) this.correctionUnavailable(); else this.options.publish(); return; }
          this.startTurn(command, requestedAtMs, deadline, admissionDeadline, result?.ok === true, result?.ok ? result.value.correction : undefined);
        }).catch(() => { if (this.pending === token) { this.pending = null; this.executing = false; if (correctionSensitive) this.correctionUnavailable(); else if (scopedRefusal) this.options.publish(); else this.startTurn(command, requestedAtMs, deadline, admissionDeadline, false); } });
    } else this.startTurn(command, requestedAtMs, deadline, admissionDeadline, true);
    return { status: 'accepted', conversationId: this.conversationId };
  }
  private correctionUnavailable(): void { this.turn = { phase: 'error', requestId: this.options.createId(), message: 'Не удалось безопасно исправить предпочтение. Обновите его в памяти и попробуйте снова.' }; this.options.publish(); }
  private acknowledgeSupport(text: string): void {
    this.options.transaction(() => {
      this.supportEligible = false; this.lastOffered = undefined; this.sourceUserText = null;
      this.options.quietSupport!.enter();
      this.options.observation?.invalidate(); this.options.events?.suppressUnsolicited?.();
      const requestId = this.options.createId(), createdAt = this.options.timestamp();
      const user = { id: this.options.createId(), text, createdAt };
      const assistant = { id: this.options.createId(), text: LOCAL_DIALOGUE_TEXT.support_quiet_ack[this.options.locale === 'en' ? 'en' : 'ru'], createdAt };
      this.options.applyStimulus({ type: 'user_message', source: 'user', requestId, text, createdAt });
      this.turn = { phase: 'completed', requestId, replyText: assistant.text, outcome: { kind: 'local', reason: 'quiet_support' } };
      const pair: AIProviderContextMessage[] = [{ role: 'user', text, createdAt }, { role: 'wisp', text: assistant.text, createdAt }];
      this.context = this.options.memory?.contextLimits ? boundMemoryContext([...this.context, ...pair], this.options.memory.contextLimits) : [...this.context, ...pair].slice(-6);
      this.contextMessageIds = [...this.contextMessageIds, user.id, assistant.id].slice(-this.context.length);
      this.options.publish();
      this.options.memory?.completed({ user, assistant, localOnly: true, memoryConfirmable: false, memoryGeneration: this.options.memory.generation() });
    });
  }
  private startTurn(command: Extract<import('../../shared/ipc-contracts').DialogueCommandDTO, { type: 'send' }>, requestedAtMs: number, deadline: number, admissionDeadline: number, enrich: boolean, correction?: Omit<BeverageCorrectionTurn, 'requestId' | 'userMessageId'>): void {
    this.options.observation?.invalidate();
    const previousTouch = this.options.interactionEnabled ? this.options.events?.getPreviousTouch?.() : undefined;
    const previousInitiative = this.options.events?.takePreviousInitiative();
    const requestId = this.options.createId();
    const createdAt = this.options.timestamp();
    this.executing = true;
    this.options.transaction(() => {
      const interactionReceipt = this.options.beginInteraction?.();
      if (!interactionReceipt) this.options.applyStimulus({ type: 'user_message', source: 'user', requestId, text: command.text, createdAt });
      const request: AIProviderRequest = { ...(this.options.interactionEnabled ? { interaction: { card: { id: 'curiousStubbornGirl', revision: 2 }, effectPolicy: interactionReceipt?.effectPolicy ?? 'suppressed', ...(previousTouch ? { previousTouch } : {}) } } : {}), requestId, ...(previousInitiative ? { previousInitiative } : {}), userMessage: { id: this.options.createId(), text: command.text, createdAt },
        characterSnapshot: this.options.getCharacterSnapshot(), recentContext: this.context.map(message => ({ ...message })), locale: this.options.locale ?? 'ru' };
      const active: Turn = { ...(command.requestBeverageProposal ? { requestBeverageProposal: true } : {}), ...(correction ? { beverageCorrection: correction } : {}), ...(interactionReceipt ? { interactionReceipt } : {}), request, generation: this.generation, deadline, requestedAtMs, admissionDeadline: enrich ? admissionDeadline : requestedAtMs, ...(command.replyToInterestThread ? { replyTo: command.replyToInterestThread } : {}), memoryGeneration: this.options.memory?.generation() ?? 0 };
      this.active = active; this.turn = { phase: 'thinking', requestId };
      this.timer = this.options.scheduler.setTimeout(() => this.finish(active, 'timeout'), Math.max(0, deadline - this.options.now()));
      this.options.setBehaviorContext?.({ requestId, conversationId: this.conversationId, generation: this.generation, requestedAtMs });
      this.options.beginThinking(requestId); this.options.publish();
      void Promise.resolve().then(() => this.execute(active));
    });
  }
  private reset(): void {
    if (this.pending) this.executing = false;
    this.options.memory?.beverage?.invalidateOffer();
    this.pending = null; this.lastOffered = undefined; this.sourceUserText = null; this.supportEligible = false;
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
      const rawStatus = await this.options.provider.getStatus();
      if (!this.mayContinue(turn)) return;
      const status = parseProviderStatus(rawStatus);
      if (status.kind === 'offline') { this.executing = false; this.finish(turn, 'offline'); return; }
      if (status.kind !== 'ready' && status.kind !== 'degraded') { this.executing = false; this.finish(turn, 'provider_error'); return; }
      const needsEnrichment = !!this.options.memory?.beverage || !!this.options.summary || !!this.options.memory?.recall || !!((this.options.provider.supportsDialogueTopic || turn.replyTo) && this.options.memory?.interestThread);
      const enriched = needsEnrichment ? await this.admission.run(turn.admissionDeadline, async () => {
        let request = turn.request;
        const alive = () => this.isCurrent(turn) && this.options.now() < turn.admissionDeadline && (this.options.memory?.generation() ?? turn.memoryGeneration) === turn.memoryGeneration;
        const summary = this.options.summary ? await this.options.summary.capture(request.userMessage.text) : undefined;
        if (!alive()) return undefined;
        if (this.options.memory?.recall) {
          const recalled = await this.options.memory.recall.recall({ text: request.userMessage.text, excludedMessageIds: [...this.contextMessageIds, ...(summary?.excludedMessageIds ?? [])] }, { generation: turn.memoryGeneration });
          if (!alive()) return undefined;
          request = { ...request, memoryContext: recalled.ok ? recalled.value : emptyMemoryContext() };
        }
        if (summary) {
          if (!this.options.summary?.isCurrent(summary)) request = { ...request, memoryContext: emptyMemoryContext() };
          else {
            const withSummary = { ...request, summary: { text: summary.text } };
            if (this.options.provider.canIncludeSummary?.(withSummary) !== false) request = withSummary;
            else if (this.options.memory?.recall) {
              const recalled = await this.options.memory.recall.recall({ text: request.userMessage.text, excludedMessageIds: [...this.contextMessageIds] }, { generation: turn.memoryGeneration });
              if (!alive()) return undefined;
              request = { ...request, memoryContext: recalled.ok && this.options.summary.isCurrent(summary) ? recalled.value : emptyMemoryContext() };
            }
          }
        }
        if ((this.options.provider.supportsDialogueTopic || turn.replyTo) && this.options.memory?.interestThread) {
          const prepared = await this.options.memory.interestThread.prepare({ requestId: request.requestId, userMessageId: request.userMessage.id, text: request.userMessage.text, ...(turn.replyTo ? { replyTo: turn.replyTo } : {}), deadlineMs: turn.admissionDeadline }, { generation: turn.memoryGeneration });
          if (!alive()) return undefined;
          if (prepared.ok && prepared.value && this.options.memory.interestThread.isCurrent(prepared.value)) {
            this.captures.set(turn, prepared.value); if (this.options.provider.supportsDialogueTopic) request = { ...request, dialogueTopic: prepared.value.topic };
          }
        }
        if (this.options.memory?.beverage) {
          const prepared = await this.options.memory.beverage.prepare({ requestId: request.requestId, userMessageId: request.userMessage.id, allowProposal: turn.requestBeverageProposal === true && !turn.beverageCorrection && !turn.replyTo }, { generation: turn.memoryGeneration });
          if (!alive()) return undefined;
          if (prepared.ok && prepared.value && this.options.memory.beverage.isCurrent(prepared.value)) { this.beverageCaptures.set(turn, prepared.value); request = { ...request, beveragePreference: prepared.value.context }; }
        }
        if (summary && !this.options.summary?.isCurrent(summary)) { const { summary: _staleSummary, ...withoutSummary } = request; request = { ...withoutSummary, memoryContext: emptyMemoryContext() }; }
        return request;
      }) : turn.request;
      if (!this.mayContinue(turn)) return;
      let request = enriched ?? { ...turn.request, ...(this.options.memory?.recall ? { memoryContext: emptyMemoryContext() } : {}) };
      const capture = this.captures.get(turn);
      if (turn.replyTo && !capture) { this.executing = false; this.finish(turn, 'degraded'); return; }
      if (capture && !this.options.memory?.interestThread?.isCurrent(capture)) { this.executing = false; this.finish(turn, 'degraded'); return; }
      if (request.interaction) {
        const previousTouch = this.options.events?.getPreviousTouch?.();
        request = { ...request, interaction: { card: request.interaction.card, effectPolicy: request.interaction.effectPolicy, ...(previousTouch ? { previousTouch } : {}) } };
      }
      const beverageCapture = this.beverageCaptures.get(turn);
      if (beverageCapture && !this.options.memory?.beverage?.isCurrent(beverageCapture)) { this.finish(turn, 'degraded'); return; }
      // The transport reports whether its byte cap actually retained this optional block.
      if (request.beveragePreference && this.options.provider.canIncludeBeverage?.(request) !== false) this.dispatchedBeverage.add(turn);
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
    const capture = this.captures.get(active);
    if (active.replyTo && !capture) {
      this.active = null; this.cancelTimer(); this.options.endThinking(active.request.requestId);
      this.turn = { phase: 'error', requestId: active.request.requestId, message: 'Не удалось связать ответ с темой. Обновите тему в памяти и попробуйте снова.' };
      this.options.publish(); return;
    }
    if (capture && !this.options.memory?.interestThread?.isCurrent(capture)) { reason = 'degraded'; response = undefined; }
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
          turn: { phase: 'completed', requestId, replyText, ...(capture && reason === undefined ? { interestThread: capture.use.ref } : {}), ...(reason === undefined ? { memorySource: { userMessageId: active.request.userMessage.id, assistantMessageId: assistantId } } : {}), outcome: reason === undefined ? { kind: 'success' } : { kind: 'fallback', reason } } });
      } catch {
        this.turn = { phase: 'error', requestId, message: 'Не удалось показать ответ. Попробуй позже.' };
        this.options.publish(); return;
      }
      this.turn = presentation.turn;
      this.supportEligible = reason === undefined;
      this.sourceUserText = reason === undefined && !capture && !active.beverageCorrection && !this.dispatchedBeverage.has(active) ? active.request.userMessage.text : null;
      this.lastOffered = reason === undefined ? capture?.use.ref : undefined;
      const createdAt = this.options.timestamp();
      const pair: AIProviderContextMessage[] = [{ role: 'user', text: active.request.userMessage.text, createdAt: active.request.userMessage.createdAt }, { role: 'wisp', text: replyText, createdAt }];
      this.context = capture || active.beverageCorrection || this.dispatchedBeverage.has(active) ? this.context : this.options.memory?.contextLimits ? boundMemoryContext([...this.context, ...pair], this.options.memory.contextLimits) : [...this.context, ...pair].slice(-6);
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
      if (!capture && !active.beverageCorrection && !this.dispatchedBeverage.has(active)) this.contextMessageIds = [...this.contextMessageIds, active.request.userMessage.id, assistantId].slice(-this.context.length);
      const beverage = this.dispatchedBeverage.has(active) ? this.beverageCaptures.get(active) : undefined;
      let proposal;
      if (reason === undefined && !capture && !active.beverageCorrection && beverage?.context.allowProposal && !beverage.use && response?.beverageProposal) try { proposal = parseBeverageProposal(response.beverageProposal, active.request.userMessage.text); } catch { /* Attribution is independent of the semantic model guess. */ }
      const persisted = this.options.memory?.completed({ ...(capture ? { interestThread: capture.use } : {}), ...(beverage?.use ? { beverageUse: beverage.use } : {}), ...(active.beverageCorrection ? { beverageCorrection: { ...active.beverageCorrection, requestId, userMessageId: active.request.userMessage.id } } : {}), ...(proposal ? { beverageProposalSource: true as const } : {}), user: active.request.userMessage,
        assistant: { id: assistantId, text: replyText, createdAt }, memoryConfirmable: reason === undefined, memoryGeneration: active.memoryGeneration });
      const source = { userMessageId: active.request.userMessage.id, assistantMessageId: assistantId };
      if (proposal && persisted) {
        const captured = proposal, identity = this.getIdentity();
        void persisted.then(ok => {
          if (!ok || this.getIdentity() !== identity || this.executing || this.turn.phase !== 'completed' || this.turn.requestId !== requestId) return;
          const offer = this.options.memory?.beverage?.offer(captured, source, active.memoryGeneration);
          if (offer && this.turn.phase === 'completed') { this.turn = { ...this.turn, beverageOffer: { offerId: offer.offerId, ...captured } }; this.options.publish(); }
        });
      }
    });
  }
}
