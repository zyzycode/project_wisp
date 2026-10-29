import type { TouchInteractionReceipt } from '../ports/interaction-appraisal';
import { TouchReactionContext, parseInteractionAppraisal } from './touch-reaction-context';
import type { AICompanionEvent, AIEventProviderRequest, IAIEventInterlock, IAIEventProvider, IGameEpisodeCommitObserver } from '../ports/ai-event-provider.interface';
import type { AIProviderRequest } from '../ports/ai-provider.interface';
import type { ILocalMemoryRecall } from '../ports/memory-knowledge.interface';
import type { GameEpisode, MemoryOperationContext } from '../ports/memory-repository.interface';
import type { CursorGameResult } from '../ports/cursor-game-contract';
import type { ActivityOutcomeFeedback } from '../ports/shimeji-feedback-port';
import type { MemoryScheduler } from '../ports/memory-runtime';
import type { AIInitiativeSpeechDTO, DialoguePresentationDTO } from '../../shared/ipc-contracts';
import { exactRecord, plainText } from '../../shared/dialogue-ipc-validation';
import { emptyMemoryContext } from './memory-recall';

const MAX_RECENT_EVENT_IDS = 128;

interface Gate { readonly allowed: boolean; readonly touchAllowed?: boolean; readonly identity: string | null; readonly memoryGeneration: number; readonly activeRunId: string | null; readonly localSpeech: boolean }
interface Source { readonly runId: string; readonly kind: 'cursor_game' | 'social_bid' | 'user_touch'; readonly event: AICompanionEvent; readonly terminalAt: number; readonly identity: string; readonly memoryGeneration: number; readonly epoch: number; readonly touchReceipt?: TouchInteractionReceipt }
interface Options {
  readonly touchContext?: TouchReactionContext;
  readonly transaction?: (commit: () => void) => void;
  readonly observation?: IAIEventInterlock;
  readonly provider: IAIEventProvider; readonly recall?: ILocalMemoryRecall;
  readonly now: () => number; readonly timestamp: () => string; readonly createId: () => string; readonly scheduler: MemoryScheduler;
  readonly gate: () => Gate; readonly character: () => AIProviderRequest['characterSnapshot']; readonly publish: () => void;
  readonly locale?: 'ru' | 'en';
  readonly random?: () => number;
  readonly autonomousEnabled?: boolean;
}
/** Causal speech owner; v1 touch commits bounded Character effects and a volatile trace atomically. No event queue. */
export class AIEventRuntime implements IAIEventInterlock, IGameEpisodeCommitObserver {
  private epoch = 0;
  private disposed = false;
  private source: Source | null = null;
  private game: { result: CursorGameResult; generation: number; identity: string; completed: boolean; epoch: number } | null = null;
  private readonly seen = new Set<string>();
  private pending: Promise<void> | null = null;
  private requestId: string | null = null;
  private causalTimer: unknown;
  private deadlineTimer: unknown;
  private speechTimer: unknown;
  private speech: AIInitiativeSpeechDTO | null = null;
  private previous: { value: NonNullable<AIProviderRequest['previousInitiative']>; expires: number; identity: string; generation: number } | null = null;
  private thinking = false;
  constructor(private readonly options: Options) {}
  getSpeech(): AIInitiativeSpeechDTO | null { return this.speech && this.options.now() < this.speech.expiresAtMs ? this.speech : null; }
  observeDialogue(dialogue: DialoguePresentationDTO): void {
    this.thinking = dialogue.turn.phase === 'thinking';
    if (this.thinking && (this.source || this.speech)) this.invalidate(true, false);
  }
  activityStarted(): void { if (this.source?.kind !== 'user_touch') this.invalidate(false, false); }
  suppressUnsolicited(): void {
    this.previous = null; this.game = null;
    if (this.source?.kind !== 'user_touch') this.invalidate(true, false);
  }
  isBusy(): boolean { return this.pending !== null || this.source !== null; }
  isTouchPending(): boolean { return this.source?.kind === 'user_touch' && this.pending !== null; }
  getPreviousTouch() { return this.options.touchContext?.get(); }
  touch(touchReceipt?: TouchInteractionReceipt): void {
    if (this.pending) return;
    this.userContact();
    const gate = this.options.gate();
    if (!gate.identity || !this.baseAllowed(true)) return;
    const variants = ['stroke', 'touch', 'ruffle', 'poke'] as const;
    const variant = touchReceipt ? 'touch' : variants[Math.floor((this.options.random?.() ?? 0) * variants.length)] ?? 'touch';
    const source: Source = { runId: this.options.createId(), kind: 'user_touch', terminalAt: this.options.now(), epoch: this.epoch,
      identity: gate.identity, memoryGeneration: gate.memoryGeneration, ...(touchReceipt ? { touchReceipt } : {}),
      event: { type: 'user_touch', variant, occurredAt: this.options.timestamp() } };
    this.source = source; this.begin(source);
  }
  tick(): void { if ((this.source || this.game || this.speech) && !this.baseAllowed()) this.invalidate(true, false); }
  userContact(): void { this.invalidate(true, false); }
  takePreviousInitiative(): AIProviderRequest['previousInitiative'] {
    const gate = this.options.gate(), prior = this.previous;
    const value = prior && this.options.now() < prior.expires && gate.identity === prior.identity && gate.memoryGeneration === prior.generation ? prior.value : undefined;
    this.userContact(); return value;
  }
  async interruptForUser(): Promise<void> { this.invalidate(true, false); await this.pending; }
  invalidate(clearPrevious = true, clearTouch = true): void {
    if (clearTouch) this.options.touchContext?.clear();
    this.epoch++; this.source = null; this.game = null; if (clearPrevious) this.previous = null;
    this.options.scheduler.clearTimeout(this.causalTimer); this.options.scheduler.clearTimeout(this.deadlineTimer); this.options.scheduler.clearTimeout(this.speechTimer);
    if (this.requestId) this.options.provider.cancel(this.requestId);
    const changed = this.speech !== null; this.speech = null; if (changed) this.options.publish();
  }
  dispose(): void { this.disposed = true; this.invalidate(); this.seen.clear(); }
  gameTerminal(result: CursorGameResult, generation: number): void {
    if (this.options.autonomousEnabled === false) return;
    if (this.pending || this.source) return;
    const gate = this.options.gate();
    if (this.disposed || !gate.identity || gate.memoryGeneration !== generation || !result.playCompleted || result.outcome === 'cancelled' || result.executedMs > 60000) return;
    this.game = { result, generation, identity: gate.identity, completed: false, epoch: this.epoch };
  }
  outcome(outcome: ActivityOutcomeFeedback): void {
    if (this.source?.kind === 'social_bid' && this.source.runId === outcome.activityRunId) this.invalidate(false, false);
    if (this.game?.result.activityRunId === outcome.activityRunId) {
      if (outcome.outcome === 'completed' && outcome.family === 'cursor_interest' && outcome.playCompleted) this.game.completed = true;
      else this.game = null;
    }
  }
  committed(episode: GameEpisode, context: MemoryOperationContext): void {
    if (this.disposed) return;
    const key = `game:${context.generation}:${episode.appRunId}:${episode.activityRunId}`;
    if (!this.rememberEvent(key)) return;
    const game = this.game;
    if (!game || !game.completed || game.generation !== context.generation || game.result.activityRunId !== episode.activityRunId || game.result.outcome !== episode.outcome
      || game.epoch !== this.epoch || this.options.now() >= game.result.atMs + 2000 || this.pending || this.source || !this.baseAllowed()) return;
    this.game = null;
    if (episode.outcome === 'cancelled') return;
    const source: Source = { runId: episode.activityRunId, kind: 'cursor_game', terminalAt: game.result.atMs, epoch: this.epoch, identity: game.identity, memoryGeneration: context.generation,
      event: { type: 'cursor_game_completed', outcome: episode.outcome, executedMs: episode.executedMs, occurredAt: episode.endedAt } };
    this.source = source;
    this.causalTimer = this.options.scheduler.setTimeout(() => { if (this.options.now() < source.terminalAt + 2500) this.begin(source); else this.source = null; }, Math.max(0, source.terminalAt + 2000 - this.options.now()));
  }
  socialStarted(runId: string, atMs: number): void {
    if (this.disposed || this.options.autonomousEnabled === false) return;
    const key = `social:${runId}`; if (!this.rememberEvent(key)) return;
    const gate = this.options.gate();
    if (this.pending || this.source || !gate.identity || !this.baseAllowed() || gate.activeRunId !== runId) return;
    const source: Source = { runId, kind: 'social_bid', terminalAt: atMs, epoch: this.epoch, identity: gate.identity, memoryGeneration: gate.memoryGeneration,
      event: { type: 'social_bid_started', occurredAt: this.options.timestamp() } };
    this.source = source; this.begin(source);
  }
  private rememberEvent(key: string): boolean {
    if (this.seen.has(key)) return false;
    // Older game callbacks also need a current terminal/deadline; social callbacks need the active run.
    this.seen.add(key);
    if (this.seen.size > MAX_RECENT_EVENT_IDS) this.seen.delete(this.seen.values().next().value!);
    return true;
  }
  private baseAllowed(touch = this.source?.kind === 'user_touch'): boolean {
    const gate = this.options.gate();
    return !this.disposed && (touch ? gate.touchAllowed ?? gate.allowed : gate.allowed) && !this.thinking;
  }
  private current(source: Source): boolean {
    const gate = this.options.gate();
    return this.source === source && source.epoch === this.epoch && this.baseAllowed() && gate.identity === source.identity && gate.memoryGeneration === source.memoryGeneration
      && (source.kind === 'user_touch' || (source.kind === 'social_bid' ? gate.activeRunId === source.runId : gate.activeRunId === null));
  }
  private begin(source: Source): void {
    if (this.pending || !this.current(source)) { if (this.source === source) this.source = null; return; }
    const duration = source.kind === 'user_touch' ? 15000 : 3500;
    const deadline = this.options.now() + duration;
    this.deadlineTimer = this.options.scheduler.setTimeout(() => { if (this.source === source) { if (source.touchReceipt && this.current(source)) this.publishTouch(source); else this.invalidate(true, false); if (this.requestId) this.options.provider.cancel(this.requestId); } }, duration);
    const execution = Promise.resolve().then(() => this.execute(source, deadline));
    this.pending = execution;
    void execution.finally(() => { if (this.pending === execution) this.pending = null; });
  }
  private async execute(source: Source, deadline: number): Promise<void> {
    try {
      if (source.kind === 'user_touch') { await this.options.observation?.interruptForUser(); if (!this.current(source)) return; if (this.options.now() >= deadline) { this.publishTouch(source); return; } }
      const locale = this.options.locale ?? 'ru';
      const query = source.kind === 'cursor_game' ? locale === 'ru' ? 'игра курсор' : 'cursor game' : '';
      if (!this.current(source)) return;
      const recalled = source.kind === 'user_touch' ? undefined : await this.options.recall?.recall({ text: query, useFavoriteTopic: source.kind === 'social_bid', excludedMessageIds: [] }, { generation: source.memoryGeneration });
      if (!this.current(source)) return; if (this.options.now() >= deadline) { this.publishTouch(source); return; }
      const memory = recalled?.ok ? recalled.value : emptyMemoryContext();
      const requestId = this.options.createId(); this.requestId = requestId;
      const request: AIEventProviderRequest = { ...(source.touchReceipt ? { interaction: { card: { id: 'curiousStubbornGirl', revision: 3 }, effectPolicy: source.touchReceipt.effectPolicy } } : {}), requestId, event: source.event, characterSnapshot: this.options.character(), memoryContext: memory, locale };
      const raw = await this.options.provider.generateEvent(request);
      this.requestId = null;
      if (!this.current(source) || this.options.gate().localSpeech) return;
      if (this.options.now() >= deadline) { this.publishTouch(source); return; }
      const result = exactRecord(raw, ['requestId', 'replyText'], source.touchReceipt ? ['appraisal'] : []); if (result.requestId !== requestId) throw new TypeError('Invalid request id');
      const text = plainText(result.replyText, 240, true), now = this.options.now();
      if (source.touchReceipt) { const appraisal = parseInteractionAppraisal(result.appraisal, true); if (source.touchReceipt.effectPolicy === 'suppressed' && (appraisal.category !== 'neutral' || appraisal.confidence !== 'clear')) throw new TypeError('Suppressed appraisal'); this.publishTouch(source, text, appraisal); return; }
      const expiresAtMs = Math.min(now + 2000, source.kind === 'cursor_game' ? source.terminalAt + 8000 : Infinity);
      if (expiresAtMs <= now) return;
      this.speech = { id: requestId, text, startedAtMs: now, expiresAtMs };
      this.previous = source.kind === 'user_touch' ? null : { value: { kind: source.kind, text, createdAt: this.options.timestamp() }, expires: now + 60000, identity: source.identity, generation: source.memoryGeneration };
      this.options.publish();
      this.speechTimer = this.options.scheduler.setTimeout(() => { if (this.speech?.id === requestId) { this.speech = null; if (this.source === source) this.source = null; this.options.publish(); } }, expiresAtMs - now);
    } catch { if (source.touchReceipt && this.current(source)) this.publishTouch(source); }
    finally {
      this.requestId = null; this.options.scheduler.clearTimeout(this.deadlineTimer);
      if (this.source === source && !this.speech) this.source = null;
    }
  }
  private publishTouch(source: Source, text?: string, appraisal?: import('../ports/interaction-appraisal').InteractionAppraisal): void {
    if (!source.touchReceipt || !this.options.touchContext || !this.current(source) || this.options.gate().localSpeech || this.speech?.id === source.runId) return;
    const commit = () => {
      const published = this.options.touchContext!.publish(source.touchReceipt!, source.event.occurredAt, text, appraisal, this.options.locale ?? 'ru');
      const now = this.options.now();
      this.speech = { id: source.runId, text: published, startedAtMs: now, expiresAtMs: now + 2000 };
      this.options.publish();
      this.speechTimer = this.options.scheduler.setTimeout(() => { if (this.speech?.id === source.runId) { this.speech = null; if (this.source === source) this.source = null; this.options.publish(); } }, 2000);
    };
    if (this.options.transaction) this.options.transaction(commit); else commit();
  }

}
