import type { AICompanionEvent, AIEventProviderRequest, IAIEventInterlock, IAIEventProvider, IAIEventRequestControl, IGameEpisodeCommitObserver } from '../ports/ai-event-provider.interface';
import type { AIProviderRequest } from '../ports/ai-provider.interface';
import type { ILocalMemoryRecall } from '../ports/memory-knowledge.interface';
import type { GameEpisode, MemoryOperationContext } from '../ports/memory-repository.interface';
import type { CursorGameResult } from '../ports/cursor-game-contract';
import type { ActivityOutcomeFeedback } from '../ports/shimeji-feedback-port';
import type { MemoryScheduler } from '../ports/memory-runtime';
import type { AIInitiativeSpeechDTO, DialoguePresentationDTO } from '../../shared/ipc-contracts';
import { exactRecord, plainText } from '../../shared/dialogue-ipc-validation';
import { emptyMemoryContext } from './memory-recall';

interface Gate { readonly allowed: boolean; readonly identity: string | null; readonly memoryGeneration: number; readonly activeRunId: string | null; readonly localSpeech: boolean }
interface Source { readonly runId: string; readonly kind: 'cursor_game' | 'social_bid'; readonly event: AICompanionEvent; readonly terminalAt: number; readonly identity: string; readonly memoryGeneration: number; readonly epoch: number }
interface Options {
  readonly provider: IAIEventProvider; readonly control: IAIEventRequestControl; readonly recall: ILocalMemoryRecall;
  readonly now: () => number; readonly timestamp: () => string; readonly createId: () => string; readonly scheduler: MemoryScheduler;
  readonly gate: () => Gate; readonly character: () => AIProviderRequest['characterSnapshot']; readonly publish: () => void;
  readonly locale?: 'ru' | 'en';
}
/** Causal optional speech only. No Activity/Character/history mutation or event queue. */
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
  private dialogueKey: string | null = null;
  private thinking = false;
  private dialogueGuard = 0;
  private ignored = 0;
  private suppressedUntil = 0;
  private socialLineRun: string | null = null;
  constructor(private readonly options: Options) {}
  getSpeech(): AIInitiativeSpeechDTO | null { return this.speech && this.options.now() < this.speech.expiresAtMs ? this.speech : null; }
  observeDialogue(dialogue: DialoguePresentationDTO): void {
    this.thinking = dialogue.turn.phase === 'thinking';
    if (dialogue.turn.phase === 'completed' || dialogue.turn.phase === 'error') {
      const key = `${dialogue.conversationId}:${dialogue.turn.requestId}`;
      if (key !== this.dialogueKey) { this.dialogueKey = key; this.dialogueGuard = this.options.now() + 5000; }
    }
    if (this.thinking && (this.source || this.speech)) this.invalidate();
  }
  activityStarted(): void { this.invalidate(false); }
  tick(): void { if ((this.source || this.game || this.speech) && !this.baseAllowed()) this.invalidate(); }
  userContact(): void { this.ignored = 0; this.suppressedUntil = 0; this.socialLineRun = null; this.invalidate(); }
  takePreviousInitiative(): AIProviderRequest['previousInitiative'] {
    const gate = this.options.gate(), prior = this.previous;
    const value = prior && this.options.now() < prior.expires && gate.identity === prior.identity && gate.memoryGeneration === prior.generation ? prior.value : undefined;
    this.userContact(); return value;
  }
  async interruptForUser(): Promise<void> { this.invalidate(); await this.pending; }
  invalidate(clearPrevious = true): void {
    this.epoch++; this.source = null; this.game = null; if (clearPrevious) this.previous = null;
    this.options.scheduler.clearTimeout(this.causalTimer); this.options.scheduler.clearTimeout(this.deadlineTimer); this.options.scheduler.clearTimeout(this.speechTimer);
    if (this.requestId) this.options.provider.cancel(this.requestId);
    const changed = this.speech !== null; this.speech = null; if (changed) this.options.publish();
  }
  dispose(): void { this.disposed = true; this.invalidate(); }
  gameTerminal(result: CursorGameResult, generation: number): void {
    if (this.pending || this.source) return;
    const gate = this.options.gate();
    if (this.disposed || !gate.identity || gate.memoryGeneration !== generation || !result.playCompleted || result.outcome === 'cancelled' || result.executedMs > 60000) return;
    this.game = { result, generation, identity: gate.identity, completed: false, epoch: this.epoch };
  }
  outcome(outcome: ActivityOutcomeFeedback): void {
    if (outcome.family === 'social_bid' && this.socialLineRun === outcome.activityRunId) {
      this.socialLineRun = null;
      if (outcome.outcome === 'completed') { this.ignored++; if (this.ignored >= 2) this.suppressedUntil = this.options.now() + 1800000; }
    }
    if (this.source?.kind === 'social_bid' && this.source.runId === outcome.activityRunId) this.invalidate(false);
    if (this.game?.result.activityRunId === outcome.activityRunId) {
      if (outcome.outcome === 'completed' && outcome.family === 'cursor_interest' && outcome.playCompleted) this.game.completed = true;
      else this.game = null;
    }
  }
  committed(episode: GameEpisode, context: MemoryOperationContext): void {
    const key = `game:${context.generation}:${episode.appRunId}:${episode.activityRunId}`;
    if (this.seen.has(key)) return; this.seen.add(key);
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
    const key = `social:${runId}`; if (this.seen.has(key)) return; this.seen.add(key);
    const gate = this.options.gate();
    if (this.pending || this.source || !gate.identity || !this.baseAllowed() || gate.activeRunId !== runId) return;
    const source: Source = { runId, kind: 'social_bid', terminalAt: atMs, epoch: this.epoch, identity: gate.identity, memoryGeneration: gate.memoryGeneration,
      event: { type: 'social_bid_started', occurredAt: this.options.timestamp() } };
    this.source = source; this.begin(source);
  }
  private baseAllowed(): boolean {
    return !this.disposed && this.options.gate().allowed && !this.thinking && this.options.now() >= this.dialogueGuard && this.options.now() >= this.suppressedUntil;
  }
  private current(source: Source): boolean {
    const gate = this.options.gate();
    return this.source === source && source.epoch === this.epoch && this.baseAllowed() && gate.identity === source.identity && gate.memoryGeneration === source.memoryGeneration
      && (source.kind === 'social_bid' ? gate.activeRunId === source.runId : gate.activeRunId === null);
  }
  private begin(source: Source): void {
    if (this.pending || !this.current(source) || !this.options.control.eventAvailability(this.options.now()).available) { if (this.source === source) this.source = null; return; }
    const deadline = this.options.now() + 3500;
    this.deadlineTimer = this.options.scheduler.setTimeout(() => { if (this.source === source) this.invalidate(); }, 3500);
    const execution = this.execute(source, deadline);
    this.pending = execution;
    void execution.finally(() => { if (this.pending === execution) this.pending = null; });
  }
  private async execute(source: Source, deadline: number): Promise<void> {
    try {
      const locale = this.options.locale ?? 'ru';
      const query = source.kind === 'cursor_game' ? locale === 'ru' ? 'игра курсор' : 'cursor game' : '';
      const recalled = await this.options.recall.recall({ text: query, useFavoriteTopic: source.kind === 'social_bid', excludedMessageIds: [] }, { generation: source.memoryGeneration });
      if (!this.current(source) || this.options.now() >= deadline || !this.options.control.eventAvailability(this.options.now()).available) return;
      const memory = recalled.ok ? recalled.value : emptyMemoryContext();
      const requestId = this.options.createId(); this.requestId = requestId;
      const request: AIEventProviderRequest = { requestId, event: source.event, characterSnapshot: this.options.character(), memoryContext: memory, locale };
      const raw = await this.options.provider.generateEvent(request);
      this.requestId = null;
      if (!this.current(source) || this.options.now() >= deadline || this.options.gate().localSpeech) return;
      const result = exactRecord(raw, ['requestId', 'replyText']); if (result.requestId !== requestId) return;
      const text = plainText(result.replyText, 240, true), now = this.options.now();
      const expiresAtMs = Math.min(now + 2000, source.kind === 'cursor_game' ? source.terminalAt + 8000 : Infinity);
      if (expiresAtMs <= now) return;
      this.speech = { id: requestId, text, startedAtMs: now, expiresAtMs };
      this.previous = { value: { kind: source.kind, text, createdAt: this.options.timestamp() }, expires: now + 60000, identity: source.identity, generation: source.memoryGeneration };
      if (source.kind === 'social_bid') this.socialLineRun = source.runId;
      this.options.publish();
      this.speechTimer = this.options.scheduler.setTimeout(() => { if (this.speech?.id === requestId) { this.speech = null; if (this.source === source) this.source = null; this.options.publish(); } }, expiresAtMs - now);
    } catch { /* Optional speech failure preserves the existing local gesture/game. */ }
    finally {
      this.requestId = null; this.options.scheduler.clearTimeout(this.deadlineTimer);
      if (this.source === source && !this.speech) this.source = null;
    }
  }
}
