import type { CausalLifeEpisode, ICausalLifeCommitObserver } from '../ports/causal-life.interface';
import type { MemoryOperationContext, MemoryResult } from '../ports/memory-repository.interface';
import type { MemoryScheduler } from '../ports/memory-runtime';
import type { ISocialInterpretationRepository, SocialInterpretation } from '../ports/social-interpretation.interface';
import { addInterruptionReport, createInterruptionInterpretation, recognizeInterruptionReport, sameInterpretationEpisode } from '../../domain/character/social-interpretation';
import type { CharacterStateService } from './character-state.service';

interface Options {
  readonly repository?: ISocialInterpretationRepository;
  readonly character: Pick<CharacterStateService, 'getCausalAffectGeneration' | 'reappraiseInterruption'>;
  readonly context: () => MemoryOperationContext | null;
  readonly appRunId: () => string;
  readonly now: () => number;
  readonly timestamp: () => string;
  readonly scheduler: MemoryScheduler;
}
interface Binding {
  readonly episode: CausalLifeEpisode;
  readonly expiresAtMs: number;
  readonly generation: number;
  readonly characterGeneration: number;
}
export interface CommittedClarificationMessage {
  readonly conversationSessionId: string;
  readonly userMessageId: string;
  readonly text: string;
  readonly createdAt: string;
}

/** A local source-linked explanation; reads never create or reapply an experience. */
export class SocialInterpretationRuntime implements ICausalLifeCommitObserver {
  private epoch = 0;
  private disposed = false;
  private cached: SocialInterpretation | null = null;
  private binding: Binding | null = null;
  private latestSequence = 0;
  private latestAppRunId: string | null = null;
  private lastGameStart = Number.NEGATIVE_INFINITY;
  private pending: Promise<void> | null = null;
  private queuedDeadline: number | null = null;
  private cancelWait: (() => void) | undefined;
  private applied: { readonly sequence: number; readonly appRunId: string; readonly generation: number; readonly messageId: string } | null = null;
  constructor(private readonly options: Options) {}
  committed(episode: CausalLifeEpisode, context: MemoryOperationContext, atMs: number): void {
    if (!this.currentContext(context) || episode.appRunId !== this.options.appRunId() || !createInterruptionInterpretation(episode, 1)
      || !Number.isFinite(atMs) || atMs < 0 || atMs > this.options.now() || atMs <= this.lastGameStart) return;
    if (this.latestAppRunId === episode.appRunId && episode.sequence <= this.latestSequence) return;
    this.latestAppRunId = episode.appRunId; this.latestSequence = episode.sequence;
    this.clearProjection(); this.epoch++;
    this.binding = { episode, generation: context.generation, expiresAtMs: atMs + 300000,
      characterGeneration: this.options.character.getCausalAffectGeneration() };
    this.queuedDeadline = this.options.now() + 200;
    this.startQueued();
  }
  /** Actual cursor-game start closes the previous episode's clarification window. */
  gameStarted(): void {
    this.lastGameStart = this.options.now(); this.epoch++; this.binding = null; this.queuedDeadline = null; this.cancelWait?.();
  }
  getCurrent(): SocialInterpretation | null {
    const current = this.cached, now = this.options.timestamp();
    if (!current || this.disposed) return null;
    if (now < current.createdAt || now >= current.expiresAt) { this.invalidate(); return null; }
    return { ...current, episode: { ...current.episode }, reports: current.reports.map(source => ({ ...source })) };
  }
  invalidate(): void {
    this.clearProjection(); this.epoch++; this.binding = null; this.queuedDeadline = null; this.cancelWait?.();
  }
  dispose(): void { this.invalidate(); this.disposed = true; }
  refresh(): Promise<void> {
    const context = this.options.context(), repository = this.options.repository;
    if (!context || !repository || this.disposed || this.pending) return this.pending ?? Promise.resolve();
    return this.run(this.options.now() + 200, async valid => {
      const result = await this.safe(() => repository.read(this.options.timestamp(), context));
      if (valid() && result.ok) this.acceptRead(result.value);
    });
  }
  async persisted(message: CommittedClarificationMessage, context: MemoryOperationContext): Promise<void> {
    const report = recognizeInterruptionReport(message.text);
    if (!report || !this.currentContext(context)) return;
    const deadline = this.options.now() + 200;
    if (this.pending) await this.idleBefore(deadline);
    const binding = this.binding;
    if (!binding || this.pending || !this.bindingCurrent(binding, context)) return;
    const source = { conversationSessionId: message.conversationSessionId, userMessageId: message.userMessageId, revision: 1 as const, report };
    await this.run(deadline, async valid => {
      const current = await this.prepare(binding, context, valid);
      if (!current || !valid() || !this.bindingCurrent(binding, context)) return;
      const desired = addInterruptionReport(current, source);
      if (desired === current) return;
      const result = await this.safe(() => this.options.repository!.replace(desired, current.revision, this.options.timestamp(), context));
      if (!valid() || !this.bindingCurrent(binding, context)) return;
      if (!result.ok) { if (result.code === 'conflict') await this.reread(context, valid); return; }
      this.cached = desired;
      this.options.character.reappraiseInterruption(desired.episode.sequence, desired.status, this.options.now(), binding.characterGeneration);
      this.applied = desired.status === 'reported_accidental'
        ? { sequence: desired.episode.sequence, appRunId: desired.episode.appRunId, generation: binding.characterGeneration, messageId: source.userMessageId } : null;
    });
  }
  private startQueued(): void {
    if (this.pending || this.queuedDeadline === null) return;
    const deadline = this.queuedDeadline, binding = this.binding, context = this.options.context(); this.queuedDeadline = null;
    if (!binding || !context || !this.bindingCurrent(binding, context)) return;
    void this.run(deadline, async valid => { await this.prepare(binding, context, valid); });
  }
  private async prepare(binding: Binding, context: MemoryOperationContext, valid: () => boolean): Promise<SocialInterpretation | null> {
    const repository = this.options.repository;
    if (!repository || !valid() || !this.bindingCurrent(binding, context)) return null;
    const read = await this.safe(() => repository.read(this.options.timestamp(), context));
    if (!read.ok || !valid() || !this.bindingCurrent(binding, context)) return null;
    if (read.value && sameInterpretationEpisode(read.value.episode, binding.episode)) { this.acceptRead(read.value); return read.value; }
    const desired = createInterruptionInterpretation(binding.episode, (read.value?.revision ?? 0) + 1);
    if (!desired) return null;
    const result = await this.safe(() => repository.replace(desired, read.value?.revision ?? null, this.options.timestamp(), context));
    if (!result.ok || !valid() || !this.bindingCurrent(binding, context)) {
      if (valid() && !result.ok && result.code === 'conflict') await this.reread(context, valid);
      return null;
    }
    this.cached = desired; return desired;
  }
  private async reread(context: MemoryOperationContext, valid: () => boolean): Promise<void> {
    const result = await this.safe(() => this.options.repository!.read(this.options.timestamp(), context));
    if (valid() && result.ok) this.acceptRead(result.value);
  }
  private bindingCurrent(binding: Binding, context: MemoryOperationContext): boolean {
    const now = this.options.now(), wall = this.options.timestamp(), occurred = binding.episode.occurredAt;
    return this.currentContext(context) && this.binding === binding && binding.generation === context.generation
      && binding.episode.appRunId === this.options.appRunId() && Number.isFinite(now) && now <= binding.expiresAtMs
      && wall >= occurred && Date.parse(wall) - Date.parse(occurred) <= 300000;
  }
  private currentContext(context: MemoryOperationContext): boolean {
    return !this.disposed && this.options.context()?.generation === context.generation;
  }
  private clearProjection(): void {
    if (this.applied?.appRunId === this.options.appRunId()) this.options.character.reappraiseInterruption(
      this.applied.sequence, 'unknown', this.options.now(), this.applied.generation);
    this.applied = null; this.cached = null;
  }
  private acceptRead(value: SocialInterpretation | null): void {
    if (this.applied && (!value || value.status !== 'reported_accidental'
      || value.episode.appRunId !== this.applied.appRunId || value.episode.sequence !== this.applied.sequence
      || !value.reports.some(source => source.userMessageId === this.applied!.messageId && source.report === 'accidental'))) this.clearProjection();
    this.cached = value;
  }
  private run(deadline: number, operation: (valid: () => boolean) => Promise<void>): Promise<void> {
    const now = this.options.now();
    if (this.pending || this.disposed || !Number.isFinite(now) || now < 0 || !Number.isFinite(deadline) || deadline <= now) return this.pending ?? Promise.resolve();
    const epoch = this.epoch, context = this.options.context();
    if (!context) return Promise.resolve();
    let active = true, timer: unknown;
    const valid = () => active && epoch === this.epoch && this.currentContext(context) && this.options.now() < deadline;
    const expired = new Promise<void>(resolve => {
      this.cancelWait = () => { active = false; resolve(); };
      timer = this.options.scheduler.setTimeout(() => { active = false; resolve(); }, deadline - this.options.now());
    });
    this.pending = Promise.race([operation(valid).catch(() => { if (valid()) this.clearProjection(); }), expired]).finally(() => {
      active = false; this.options.scheduler.clearTimeout(timer); this.cancelWait = undefined; this.pending = null; this.startQueued();
    });
    return this.pending;
  }
  private async idleBefore(deadline: number): Promise<void> {
    let timer: unknown, timedOut = false;
    const expired = new Promise<void>(resolve => { timer = this.options.scheduler.setTimeout(() => { timedOut = true; resolve(); }, Math.max(0, deadline - this.options.now())); });
    try { while (this.pending && !timedOut && this.options.now() < deadline) await Promise.race([this.pending, expired]); }
    finally { this.options.scheduler.clearTimeout(timer); }
  }
  private async safe<T>(operation: () => Promise<MemoryResult<T>>): Promise<MemoryResult<T>> {
    try { return await operation(); } catch { return { ok: false, code: 'unavailable' }; }
  }
}
