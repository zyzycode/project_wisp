import { MusicInterestRuntime } from './music-interest-runtime';
import { RelationshipRepairRuntime } from './relationship-repair-runtime';
import { LifeReflectionRuntime } from './life-reflection-runtime';
import type { MemoryItemMutation, MemoryItemPage, MemoryItemReceipt } from '../ports/memory-items.interface';
import { MEMORY_FACT_KEYS, parseMemoryFact } from './memory-fact-registry';
import type { IUserMemoryFactsReader, UserMemoryFact } from '../ports/memory-knowledge.interface';
import { MemoryKnowledge } from './memory-knowledge';
import type { ICharacterPreferenceLearning } from '../ports/memory-knowledge.interface';
import type { MemoryRepositories, MemoryScheduler } from '../ports/memory-runtime';
import type { MemoryFailureCode, MemoryOperationContext, MemoryResult, UserFact } from '../ports/memory-repository.interface';
import type { AIProviderContextMessage } from '../ports/ai-provider.interface';
import type { MemoryStatusDTO } from '../../shared/ipc-contracts';
import { CharacterStateService } from './character-state.service';
import { projectCharacterMemory, restoreCharacterMemory } from './character-memory-snapshot';
import { MemoryHistory } from './memory-history';
import { OwnGameInterestRuntime } from './own-game-interest-runtime';
import { SocialInterpretationRuntime } from './social-interpretation-runtime';

interface Options {
  readonly music?: { readonly random: () => number; readonly gates: () => { readonly awake: boolean; readonly quiet: boolean; readonly role: boolean } };
  readonly causalCommitObserver?: import('../ports/causal-life.interface').ICausalLifeCommitObserver;
  readonly causalObserver?: (episode: import('../ports/causal-life.interface').CausalLifeEpisode, atMs: number) => void;
  readonly summary?: Pick<import('../ports/summary').ISummaryRuntime, 'invalidate' | 'reset' | 'dispose'>;
  readonly storage: MemoryRepositories;
  readonly character: CharacterStateService;
  readonly scheduler: MemoryScheduler;
  readonly now: () => number;
  readonly monotonicNow?: () => number;
  readonly timestamp: () => string;
  readonly createId: () => string;
  readonly toTimestamp: (monotonicMs: number) => string;
  readonly localMock: boolean;
  readonly gameObserver?: import('../ports/ai-event-provider.interface').IGameEpisodeCommitObserver;
  readonly preferenceLearning?: ICharacterPreferenceLearning;
  readonly hydrate: (messages: readonly AIProviderContextMessage[]) => void;
  readonly start: () => void;
  readonly pause: () => void;
  readonly invalidateMemory?: (admissionToken?: object) => void;
  readonly resetCommitted: () => void;
  readonly shutdownCapture?: () => Promise<void>;
  readonly resume: () => void;
}
export class MemoryLifecycle implements IUserMemoryFactsReader {
  readonly music: MusicInterestRuntime;
  readonly history: MemoryHistory;
  readonly relationshipRepair: RelationshipRepairRuntime;
  readonly lifeReflection: LifeReflectionRuntime;
  readonly ownGameInterest: OwnGameInterestRuntime;
  readonly socialInterpretation: SocialInterpretationRuntime;
  private readonly knowledge: MemoryKnowledge;
  private generation = 0;
  private phase: 'initializing' | 'running' | 'mutating' | 'resetting' | 'stopping' = 'initializing';
  private status: MemoryStatusDTO = { mode: 'initializing' };
  private storageReady = false;
  private snapshotWritable = true;
  private savedSignature: string | null = null;
  private timer: unknown;
  private startupTimer: unknown;
  private shutdownPromise: Promise<void> | undefined;
  constructor(private readonly options: Options) {
    this.music = new MusicInterestRuntime({ repository: options.storage.music, character: options.character, context: () => this.context(), now: options.monotonicNow ?? options.now, timestamp: options.timestamp, scheduler: options.scheduler, random: options.music?.random ?? (() => 1), gates: options.music?.gates ?? (() => ({ awake: false, quiet: true, role: false })), whenSettled: () => this.history.whenSettled() });
    this.knowledge = new MemoryKnowledge({ invalidateSummary: () => { options.summary?.invalidate(); this.lifeReflection.invalidate(); this.music.invalidate(); }, facts: options.storage.facts, isCurrent: generation => this.context()?.generation === generation && this.phase === 'running', createId: options.createId, onFailure: code => this.failure(code), ...(options.preferenceLearning ? { preferenceLearning: options.preferenceLearning } : {}) });
    this.ownGameInterest = new OwnGameInterestRuntime({ appRunId: () => this.history.currentAppRunId(), repository: options.storage.causalLife, character: options.character, context: () => this.context(), scheduler: options.scheduler });
    this.socialInterpretation = new SocialInterpretationRuntime({ repository: options.storage.socialInterpretation, character: options.character,
      context: () => this.context(), appRunId: () => this.history.currentAppRunId(), now: options.monotonicNow ?? options.now,
      timestamp: options.timestamp, scheduler: options.scheduler });
    this.history = new MemoryHistory({ onUserMessagePersisted: (message, context) => this.socialInterpretation.persisted(message, context), causalCommitObserver: { committed: (episode, context, atMs) => { this.ownGameInterest.committed(episode, context, atMs); this.socialInterpretation.committed(episode, context, atMs); this.relationshipRepair.committed(episode, context, atMs); options.causalCommitObserver?.committed(episode, context, atMs); } }, causalObserver: (episode, atMs) => { this.relationshipRepair.observed(episode, atMs); options.causalObserver?.(episode, atMs); }, generation: () => this.generation, ...(options.gameObserver ? { gameObserver: options.gameObserver } : {}), onPersisted: async (turn, context, source) => { if (turn.beverageCorrection) options.summary?.invalidate(); await this.knowledge.persisted(turn, context); await this.music.persisted(turn, source, context); }, ...options.storage, context: () => this.context(), isCurrent: generation => this.storageReady && this.status.mode !== 'volatile' && this.generation === generation, createId: options.createId, toTimestamp: options.toTimestamp, onFailure: code => this.failure(code) });
    this.relationshipRepair = new RelationshipRepairRuntime({ character: options.character, repository: options.storage.causalLife,
      context: () => this.context(), appRunId: () => this.history.currentAppRunId(), now: options.monotonicNow ?? options.now,
      scheduler: options.scheduler, barrier: this.history.causal });
    this.lifeReflection = new LifeReflectionRuntime({ reader: options.storage.lifeHistory, barrier: this.history.causal, context: () => this.context(), timestamp: options.timestamp, scheduler: options.scheduler });
  }
  currentGeneration(): number { return this.generation; }
  getStatus(): MemoryStatusDTO { return { ...this.status }; }
  isRunning(): boolean { return this.phase === 'running'; }
  context(): MemoryOperationContext | null {
    return this.storageReady && (this.phase === 'initializing' || this.phase === 'running') && this.status.mode !== 'volatile' ? { generation: this.generation } : null;
  }
  async initialize(): Promise<void> {
    this.startupTimer = this.options.scheduler.setTimeout(() => this.admitInput(), 10_000);
    const ready = await this.safe(() => this.options.storage.ready);
    if (this.phase !== 'initializing') return;
    if (!ready.ok) { this.startupFailure(ready.code); this.start(); return; }
    this.storageReady = true;
    const c = { generation: this.generation };
    const snapshot = await this.safe(() => this.options.storage.character.load(c));
    if (this.phase !== 'initializing') return;
    let restore: Extract<MemoryStatusDTO, { mode: 'persistent' }>['characterRestore'] = 'default';
    let candidate = this.options.character.createDefaults();
    if (!snapshot.ok) {
      if (snapshot.code === 'invalid_data') { restore = 'invalid_snapshot'; this.snapshotWritable = false; }
      else this.startupFailure(snapshot.code);
    } else if (snapshot.value !== null) {
      if (![1, 2, 3, 4, 5, 6].includes(snapshot.value.snapshotVersion)) { restore = 'unsupported_snapshot'; this.snapshotWritable = false; }
      else try { candidate = restoreCharacterMemory(snapshot.value, candidate, this.options.now()); restore = 'restored'; }
      catch { restore = 'invalid_snapshot'; this.snapshotWritable = false; }
    }
    const context = this.options.localMock ? await this.history.hydrate() : [];
    if (this.phase !== 'initializing') return;
    await this.maintainStartupTopic();
    if (this.phase !== 'initializing') return;
    // Apply once, after every asynchronous startup dependency and before admission/ticks.
    candidate.lastUpdated = this.options.now();
    this.options.character.replaceRestoredState(candidate);
    this.music.invalidate();
    this.options.character.restoreRelationshipRepair(snapshot.ok && snapshot.value ? Date.parse(snapshot.value.updatedAt) : this.options.now());
    if (this.status.mode !== 'volatile') {
      this.status = { mode: 'persistent', characterRestore: restore };
      // Identity migrations remain dirty until the current card revision is acknowledged.
      const loadedState = snapshot.ok ? snapshot.value?.state : null;
      if (restore === 'restored' && snapshot.ok && snapshot.value?.snapshotVersion === 6
        && loadedState && typeof loadedState === 'object' && !Array.isArray(loadedState)
        && 'cardRevision' in loadedState && loadedState.cardRevision === 3) {
        this.savedSignature = JSON.stringify(projectCharacterMemory(candidate, this.options.timestamp()).state);
      }
      if (this.options.localMock) this.options.hydrate(context);
    }
    if (this.phase !== 'initializing') return;
    this.start();
    void Promise.all([this.ownGameInterest.revalidate(), this.relationshipRepair.revalidate(), this.socialInterpretation.refresh(), this.music.revalidate()]);
  }
  private async maintainStartupTopic(): Promise<void> {
    const repository = this.options.storage.interestThread;
    if (!repository || !this.context()) return;
    const generation = this.generation;
    const result = await this.safe(() => repository.read({ generation }));
    if (this.phase !== 'initializing' || this.generation !== generation || !this.storageReady) return;
    if (!result.ok) { this.failure(result.code); return; }
    const thread = result.value.thread;
    if (!thread || thread.state !== 'unanswered' || (result.value.sourceValid && Date.parse(this.options.timestamp()) < Date.parse(thread.expiresAt))) return;
    this.generation++; this.options.summary?.invalidate(); this.lifeReflection.invalidate(); this.music.invalidate(); this.history.causal.invalidate(); this.options.invalidateMemory?.();
    const next = this.generation;
    const closed = await this.safe(() => repository.mutate({ kind: 'close', commandId: this.options.createId(), expected: thread.ref, reason: result.value.sourceValid ? 'expired' : 'source_changed' }, { generation: next }));
    if (this.phase !== 'initializing' || this.generation !== next || !this.storageReady) return;
    if (!closed.ok) this.failure(closed.code);
  }

  /** Returns synchronously: first human input abandons restore, never waits on storage. */
  admitInput(): boolean {
    if (this.phase === 'initializing') {
      this.storageReady = false; this.lifeReflection.invalidate(); this.music.invalidate(); this.history.causal.invalidate(); this.options.character.invalidateOwnHabit(); this.ownGameInterest.invalidate(); this.relationshipRepair.invalidate(); this.socialInterpretation.invalidate(); this.status = { mode: 'volatile', reason: 'unavailable' };
      void this.options.storage.abort(); this.start();
    }
    return this.phase === 'running' || this.phase === 'mutating';
  }
  private start(): void {
    if (this.phase !== 'initializing') return;
    this.options.scheduler.clearTimeout(this.startupTimer); this.startupTimer = undefined;
    this.phase = 'running'; this.options.start(); this.scheduleCheckpoint();
  }
  private startupFailure(code: MemoryFailureCode): void {
    this.storageReady = false; this.lifeReflection.invalidate(); this.music.invalidate(); this.history.causal.invalidate(); this.options.character.invalidateOwnHabit(); this.ownGameInterest.invalidate(); this.relationshipRepair.invalidate(); this.socialInterpretation.invalidate(); this.status = { mode: 'volatile', reason: code === 'invalid_data' || code === 'conflict' || code === 'stale' ? 'io_error' : code }; void this.options.storage.abort();
  }
  failure(code: MemoryFailureCode): void {
    if (code === 'stale' || code === 'busy') return;
    this.storageReady = false; this.lifeReflection.invalidate(); this.music.invalidate(); this.history.causal.invalidate(); this.options.character.invalidateOwnHabit(); this.ownGameInterest.invalidate(); this.relationshipRepair.invalidate(); this.socialInterpretation.invalidate();
    this.status = { mode: 'volatile', reason: code === 'invalid_data' || code === 'conflict' ? 'io_error' : code };
    void this.options.storage.abort();
  }
  async checkpoint(): Promise<void> {
    const c = this.context(); if (!c || this.phase !== 'running' || !this.snapshotWritable) return;
    const snapshot = projectCharacterMemory(this.options.character.getState(), this.options.timestamp());
    const signature = JSON.stringify(snapshot.state); if (signature === this.savedSignature) return;
    const result = await this.safe(() => this.options.storage.character.save(snapshot, c));
    if (this.context()?.generation !== c.generation) return;
    if (result.ok) this.savedSignature = signature; else this.failure(result.code);
  }
  async upsertFact(fact: UserFact): Promise<MemoryResult<UserFact>> {
    const c = this.context(); if (!c || this.phase !== 'running') return { ok: false, code: 'unavailable' };
    this.options.summary?.invalidate(); this.lifeReflection.invalidate(); this.music.invalidate(); this.history.causal.invalidate();
    const result = await this.safe(() => this.options.storage.facts.upsert(fact, c));
    if (this.context()?.generation !== c.generation) return { ok: false, code: 'stale' };
    if (!result.ok) this.failure(result.code); return result;
  }
  async removeFact(key: string): Promise<MemoryResult<void>> {
    const c = this.context(); if (!c || this.phase !== 'running') return { ok: false, code: 'unavailable' };
    this.options.summary?.invalidate(); this.lifeReflection.invalidate(); this.music.invalidate(); this.history.causal.invalidate();
    const result = await this.safe(() => this.options.storage.facts.removeByKey(key, c));
    if (this.context()?.generation !== c.generation) return { ok: false, code: 'stale' };
    if (!result.ok) this.failure(result.code); return result;
  }
  async readFacts(): Promise<MemoryResult<readonly UserMemoryFact[]>> {
    const c = this.context();
    if (!c || this.phase !== 'running') return { ok: false, code: 'unavailable' };
    const result = await this.safe(() => this.options.storage.facts.list(100, c));
    if (this.context()?.generation !== c.generation || this.phase !== 'running') return { ok: false, code: 'stale' };
    if (!result.ok) return result;
    try {
      if (result.value.length > 100) return { ok: false, code: 'invalid_data' };
      const facts: UserMemoryFact[] = [];
      for (const fact of result.value) {
        if (!MEMORY_FACT_KEYS.some(key => key === fact.factKey)) continue;
        const projected = parseMemoryFact({ key: fact.factKey, value: fact.factValue });
        if (facts.some(existing => existing.key === projected.key)) return { ok: false, code: 'invalid_data' };
        facts.push(projected);
      }
      return { ok: true, value: facts };
    } catch { return { ok: false, code: 'invalid_data' }; }
  }
  async listItems(query: { readonly cursor: number | null; readonly limit: number }): Promise<MemoryResult<MemoryItemPage>> {
    const c = this.context(), items = this.options.storage.items;
    if (!c || !items || this.phase !== 'running') return { ok: false, code: 'unavailable' };
    const result = await this.safe(() => items.list(query, c));
    return this.context()?.generation === c.generation ? result : { ok: false, code: 'stale' };
  }
  async mutateItem(command: MemoryItemMutation): Promise<MemoryResult<MemoryItemReceipt>> {
    const items = this.options.storage.items;
    if (!items) return { ok: false, code: 'unavailable' };
    return this.mutateMemory(context => {
      switch (command.kind) {
        case 'confirm': return items.confirm(command, context);
        case 'update': return items.update(command, context);
        case 'withdraw': return items.withdraw({ ...command, kind: 'withdraw' }, context);
        case 'delete': return items.delete({ ...command, kind: 'delete' }, context);
      }
    });
  }
  async readBeverage() {
    const c = this.context(), repository = this.options.storage.beverage;
    if (!c || !repository || this.phase !== 'running') return { ok: false as const, code: 'unavailable' as const };
    const result = await this.safe(() => repository.read(c));
    return this.context()?.generation === c.generation ? result : { ok: false as const, code: 'stale' as const };
  }
  async mutateBeverage(command: import('../ports/memory-beverage.interface').BeverageMutation, admissionToken?: object) {
    const repository = this.options.storage.beverage;
    if (!repository) return { ok: false as const, code: 'unavailable' as const };
    return this.mutateMemory(context => repository.mutate(command, context), admissionToken);
  }
  async readInterestThread() {
    const c = this.context(), repository = this.options.storage.interestThread;
    if (!c || !repository || this.phase !== 'running') return { ok: false as const, code: 'unavailable' as const };
    const result = await this.safe(() => repository.read(c));
    return this.context()?.generation === c.generation ? result : { ok: false as const, code: 'stale' as const };
  }
  async mutateInterestThread(command: import('../ports/interest-thread.interface').InterestThreadMutation, admissionToken?: object) {
    const repository = this.options.storage.interestThread;
    if (!repository) return { ok: false as const, code: 'unavailable' as const };
    return this.mutateMemory(context => repository.mutate(command, context), admissionToken);
  }
  private async mutateMemory<T>(operation: (context: MemoryOperationContext) => Promise<MemoryResult<T>>, admissionToken?: object): Promise<MemoryResult<T>> {
    if (!this.context() || this.phase !== 'running') return { ok: false, code: 'unavailable' };
    this.phase = 'mutating'; this.generation++; this.stopTimer(); this.lifeReflection.invalidate(); this.music.invalidate(); this.history.causal.invalidate(); this.options.character.invalidateOwnHabit(); this.ownGameInterest.invalidate(); this.relationshipRepair.invalidate(); this.socialInterpretation.invalidate();
    const generation = this.generation;
    // Drop volatile projections even on rollback; local Character, motion and input keep running.
    this.options.summary?.invalidate(); this.options.invalidateMemory?.(admissionToken);
    const result = await this.safe(() => operation({ generation }));
    if (this.phase !== 'mutating' || this.generation !== generation) return { ok: false, code: 'stale' };
    if (!result.ok && result.code !== 'conflict' && result.code !== 'invalid_data') this.failure(result.code);
    this.phase = 'running'; await Promise.all([this.ownGameInterest.revalidate(), this.relationshipRepair.revalidate(), this.socialInterpretation.refresh(), this.music.revalidate()]);
    if (this.phase !== 'running' || this.generation !== generation) return { ok: false, code: 'stale' };
    this.scheduleCheckpoint(); return result;
  }
  async reset(): Promise<MemoryResult<void>> {
    if (this.phase !== 'running' || !this.storageReady) return { ok: false, code: 'unavailable' };
    this.options.summary?.invalidate(); this.lifeReflection.invalidate(); this.music.invalidate(); this.history.causal.invalidate();
    this.phase = 'resetting'; this.generation++; this.stopTimer(); this.options.pause(); this.options.character.invalidateOwnHabit(); this.ownGameInterest.invalidate(); this.relationshipRepair.invalidate(); this.socialInterpretation.invalidate();
    const generation = this.generation;
    const summaryReset = this.options.summary ? await this.options.summary.reset() : undefined;
    if (this.phase !== 'resetting' || this.generation !== generation) return { ok: false, code: 'stale' };
    const cleared = await this.safe(() => this.options.storage.clear.clearUserMemory({ generation }));
    const result = summaryReset && !summaryReset.ok && cleared.ok ? { ok: false as const, code: 'io_error' as const } : cleared;
    if (this.phase !== 'resetting' || this.generation !== generation) return { ok: false, code: 'stale' };
    // A committed database reset must also clear RAM, even if summary cleanup failed.
    if (cleared.ok) {
      this.options.character.resetToDefaults(); this.relationshipRepair.reset(); this.music.reset(); this.history.reset(); this.knowledge.reset(); this.savedSignature = null; this.snapshotWritable = true;
      this.status = { mode: 'persistent', characterRestore: 'default' }; this.options.resetCommitted();
    }
    if (!result.ok && result.code !== 'conflict' && result.code !== 'invalid_data') this.failure(result.code);
    this.phase = 'running'; this.options.resume(); this.scheduleCheckpoint();
    return result;
  }
  shutdown(): Promise<void> { return this.shutdownPromise ??= this.stop(); }
  private async stop(): Promise<void> {
    this.options.scheduler.clearTimeout(this.startupTimer); this.stopTimer();
    this.options.character.invalidateOwnHabit();
    this.relationshipRepair.dispose();
    const capture = this.options.shutdownCapture?.() ?? Promise.resolve();
    const c = this.context(); const sessionClose = c ? this.history.close(this.options.timestamp()) : Promise.resolve();
    this.phase = 'stopping'; this.music.dispose(); this.lifeReflection.dispose(); this.ownGameInterest.dispose(); this.socialInterpretation.dispose(); this.options.summary?.dispose(); this.options.pause(); this.history.causal.dispose();
    let grace: unknown;
    const deadline = new Promise<void>(resolve => { grace = this.options.scheduler.setTimeout(() => { void this.options.storage.abort().then(resolve); }, 7000); });
    const drain = async () => {
      if (c && this.snapshotWritable) await this.safe(() => this.options.storage.character.save(projectCharacterMemory(this.options.character.getState(), this.options.timestamp()), c));
      await capture; await sessionClose; await this.options.storage.close(this.generation);
    };
    try { await Promise.race([drain(), deadline]); } finally { this.options.scheduler.clearTimeout(grace); }
  }
  private scheduleCheckpoint(): void {
    if (this.phase !== 'running') return;
    this.timer = this.options.scheduler.setTimeout(() => { this.timer = undefined; void this.checkpoint(); this.scheduleCheckpoint(); }, 5000);
  }
  private stopTimer(): void { if (this.timer !== undefined) this.options.scheduler.clearTimeout(this.timer); this.timer = undefined; }
  private async safe<T>(operation: () => Promise<MemoryResult<T>>): Promise<MemoryResult<T>> { try { return await operation(); } catch { return { ok: false, code: 'unavailable' }; } }
}
