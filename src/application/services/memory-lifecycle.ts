import type { MemoryRepositories, MemoryScheduler } from '../ports/memory-runtime';
import type { MemoryFailureCode, MemoryOperationContext, MemoryResult, UserFact } from '../ports/memory-repository.interface';
import type { AIProviderContextMessage } from '../ports/ai-provider.interface';
import type { MemoryStatusDTO } from '../../shared/ipc-contracts';
import { CharacterStateService } from './character-state.service';
import { projectCharacterMemory, restoreCharacterMemory } from './character-memory-snapshot';
import { MemoryHistory } from './memory-history';

interface Options {
  readonly storage: MemoryRepositories;
  readonly character: CharacterStateService;
  readonly scheduler: MemoryScheduler;
  readonly now: () => number;
  readonly timestamp: () => string;
  readonly createId: () => string;
  readonly toTimestamp: (monotonicMs: number) => string;
  readonly localMock: boolean;
  readonly hydrate: (messages: readonly AIProviderContextMessage[]) => void;
  readonly start: () => void;
  readonly pause: () => void;
  readonly resetCommitted: () => void;
  readonly resume: () => void;
}
export class MemoryLifecycle {
  readonly history: MemoryHistory;
  private generation = 0;
  private phase: 'initializing' | 'running' | 'resetting' | 'stopping' = 'initializing';
  private status: MemoryStatusDTO = { mode: 'initializing' };
  private storageReady = false;
  private snapshotWritable = true;
  private savedSignature: string | null = null;
  private timer: unknown;
  private startupTimer: unknown;
  private shutdownPromise: Promise<void> | undefined;
  constructor(private readonly options: Options) {
    this.history = new MemoryHistory({ ...options.storage, context: () => this.context(), isCurrent: generation => this.storageReady && this.status.mode !== 'volatile' && this.generation === generation, createId: options.createId, toTimestamp: options.toTimestamp, onFailure: code => this.failure(code) });
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
      if (snapshot.value.snapshotVersion !== 1) { restore = 'unsupported_snapshot'; this.snapshotWritable = false; }
      else try { candidate = restoreCharacterMemory(snapshot.value, candidate, this.options.now()); restore = 'restored'; }
      catch { restore = 'invalid_snapshot'; this.snapshotWritable = false; }
    }
    const context = this.options.localMock ? await this.history.hydrate() : [];
    if (this.phase !== 'initializing') return;
    // Apply once, after every asynchronous startup dependency and before admission/ticks.
    candidate.lastUpdated = this.options.now();
    this.options.character.replaceRestoredState(candidate);
    if (this.status.mode !== 'volatile') {
      this.status = { mode: 'persistent', characterRestore: restore };
      if (restore === 'restored') this.savedSignature = JSON.stringify(projectCharacterMemory(candidate, this.options.timestamp()).state);
      if (this.options.localMock) this.options.hydrate(context);
    }
    this.start();
  }
  /** Returns synchronously: first human input abandons restore, never waits on storage. */
  admitInput(): boolean {
    if (this.phase === 'initializing') {
      this.storageReady = false; this.status = { mode: 'volatile', reason: 'unavailable' };
      void this.options.storage.abort(); this.start();
    }
    return this.phase === 'running';
  }
  private start(): void {
    if (this.phase !== 'initializing') return;
    this.options.scheduler.clearTimeout(this.startupTimer); this.startupTimer = undefined;
    this.phase = 'running'; this.options.start(); this.scheduleCheckpoint();
  }
  private startupFailure(code: MemoryFailureCode): void {
    this.storageReady = false; this.status = { mode: 'volatile', reason: code === 'invalid_data' || code === 'conflict' || code === 'stale' ? 'io_error' : code }; void this.options.storage.abort();
  }
  failure(code: MemoryFailureCode): void {
    if (code === 'stale' || code === 'busy') return;
    this.storageReady = false;
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
    const result = await this.safe(() => this.options.storage.facts.upsert(fact, c));
    if (this.context()?.generation !== c.generation) return { ok: false, code: 'stale' };
    if (!result.ok) this.failure(result.code); return result;
  }
  async removeFact(key: string): Promise<MemoryResult<void>> {
    const c = this.context(); if (!c || this.phase !== 'running') return { ok: false, code: 'unavailable' };
    const result = await this.safe(() => this.options.storage.facts.removeByKey(key, c));
    if (this.context()?.generation !== c.generation) return { ok: false, code: 'stale' };
    if (!result.ok) this.failure(result.code); return result;
  }
  async reset(): Promise<MemoryResult<void>> {
    if (this.phase !== 'running' || !this.storageReady) return { ok: false, code: 'unavailable' };
    this.phase = 'resetting'; this.generation++; this.stopTimer(); this.options.pause();
    const generation = this.generation;
    const result = await this.safe(() => this.options.storage.clear.clearUserMemory({ generation }));
    if (this.phase !== 'resetting' || this.generation !== generation) return { ok: false, code: 'stale' };
    if (result.ok) {
      this.options.character.resetToDefaults(); this.history.reset(); this.savedSignature = null; this.snapshotWritable = true;
      this.status = { mode: 'persistent', characterRestore: 'default' }; this.options.resetCommitted();
    } else if (result.code !== 'conflict' && result.code !== 'invalid_data') this.failure(result.code);
    this.phase = 'running'; this.options.resume(); this.scheduleCheckpoint();
    return result;
  }
  shutdown(): Promise<void> { return this.shutdownPromise ??= this.stop(); }
  private async stop(): Promise<void> {
    this.options.scheduler.clearTimeout(this.startupTimer); this.stopTimer();
    const c = this.context(); const sessionClose = c ? this.history.close(this.options.timestamp()) : Promise.resolve();
    this.phase = 'stopping'; this.options.pause();
    let grace: unknown;
    const deadline = new Promise<void>(resolve => { grace = this.options.scheduler.setTimeout(() => { void this.options.storage.abort().then(resolve); }, 7000); });
    const drain = async () => {
      if (c && this.snapshotWritable) await this.safe(() => this.options.storage.character.save(projectCharacterMemory(this.options.character.getState(), this.options.timestamp()), c));
      await sessionClose; await this.options.storage.close(this.generation);
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
