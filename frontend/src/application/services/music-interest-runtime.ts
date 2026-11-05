import type { BackendMusicTopicContext } from '../ports/backend-music-interest-contract';
import type { IMusicInterestRepository, MusicContextCapture, MusicDialogueSource, MusicInterestEvidence, MusicPublishedReceipt, MusicTurnAdmission } from '../ports/music-interest.interface';
import type { MemoryOperationContext, MemoryResult } from '../ports/memory-repository.interface';
import type { CompletedDialogueMemoryTurn, MemoryScheduler } from '../ports/memory-runtime';
import type { CharacterStateService } from './character-state.service';
import { acceptsMusicIntention, musicCountsDoNotDecrease, musicInterestBand, recognizeMusicMessage } from '../../domain/character/music-interest';
interface Options {
  readonly repository?: IMusicInterestRepository;
  readonly character: CharacterStateService;
  readonly context: () => MemoryOperationContext | null;
  readonly now: () => number;
  readonly timestamp: () => string;
  readonly scheduler: MemoryScheduler;
  readonly random: () => number;
  readonly gates: () => { readonly awake: boolean; readonly quiet: boolean; readonly role: boolean };
  readonly whenSettled?: () => Promise<void>;
}
/** One volatile opening and one bounded source read; never an autonomous producer. */
export class MusicInterestRuntime {
  private epoch = 0;
  private serial = 0;
  private persistedSerial = 0;
  private lastMono = 0;
  private decision: { readonly serial: number; readonly allowed: boolean } | undefined;
  private revision = 0;
  private disposed = false;
  private reading = false;
  private appending = false;
  private cancelRead: (() => void) | undefined;
  private nextSampleAt: number;
  private evidence: MusicInterestEvidence | undefined;
  private lastEvidence = '';
  private evidenceExpires = Number.POSITIVE_INFINITY;
  private lastWall = '';
  private opening: { readonly source: MusicDialogueSource; readonly topic: string; readonly conversationId: string; readonly deadline: number } | undefined;
  constructor(private readonly options: Options) { const now = options.now(); this.nextSampleAt = Number.isFinite(now) && now >= 0 ? now + 300000 : Infinity; this.lastMono = Number.isFinite(now) && now >= 0 ? now : 0; }
  beginTurn(conversationId: string, text: string): MusicTurnAdmission {
    const opening = this.opening; this.opening = undefined; this.decision = undefined;
    const now = this.options.now();
    const valid = Number.isFinite(now) && now >= this.lastMono;
    const message = valid ? recognizeMusicMessage(text) : undefined;
    if (valid) this.lastMono = now;
    const validOpening = message?.kind === 'continuation' && opening && opening.conversationId === conversationId
      && opening.topic === message.topic && now < opening.deadline;
    return { epoch: this.epoch, serial: ++this.serial, conversationId, admittedAtMs: now,
      ...(message ? { message } : {}), ...(validOpening ? { opening: opening.source, openingDeadlineMs: opening.deadline } : {}) };
  }
  async prepare(admission: MusicTurnAdmission, generation: number, gates: { readonly causal: boolean; readonly otherBundle: boolean; readonly deadlineMs: number }): Promise<MusicContextCapture | undefined> {
    // A current explicit preference stays ordinary source evidence, without an older optional projection.
    if (!admission.message || admission.message.kind === 'preference' || !this.current(admission, generation)) return undefined;
    const local = this.options.gates();
    if (this.decision?.serial !== admission.serial) {
      const eligible = admission.message.kind === 'opening' && local.awake && !local.quiet && !local.role && !gates.causal && !gates.otherBundle;
      this.decision = { serial: admission.serial, allowed: eligible && acceptsMusicIntention({ ...local, ...gates }, this.options.random()) };
    }
    if (gates.causal || gates.otherBundle) return undefined;
    const validated = await this.revalidate(gates.deadlineMs);
    if (!validated || !this.current(admission, generation) || !this.evidence || this.options.now() >= gates.deadlineMs) return undefined;
    const message = admission.message, count = this.evidence.samples.filter(s => s.topic === message.topic).length;
    const user = [...this.evidence.userPreferences].sort((a,b) => (a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : a.topic < b.topic ? -1 : a.topic > b.topic ? 1 : 0))[0];
    const currentGates = this.options.gates();
    const intention = this.decision.allowed && currentGates.awake && !currentGates.quiet && !currentGates.role;
    const context: BackendMusicTopicContext = { scope: 'text_discussion', topic: message.topic, characterInterest: musicInterestBand(count),
      ...(user ? { userPreference: { topic: user.topic, disposition: user.disposition } } : {}), ...(intention ? { intention: 'ask_music_detail' } : {}) };
    if (context.characterInterest === 'unknown' && !context.userPreference && !context.intention) return undefined;
    return { admission, memoryGeneration: generation, sourceRevision: this.revision, context };
  }
  isCurrent(capture: MusicContextCapture): boolean {
    return this.current(capture.admission, capture.memoryGeneration) && capture.sourceRevision === this.revision && !!this.evidence
      && (() => { const now = this.clock(); return now !== undefined && Date.parse(now) < this.evidenceExpires; })() && (!capture.context.intention || (this.options.gates().awake && !this.options.gates().quiet && !this.options.gates().role));
  }
  private current(admission: MusicTurnAdmission, generation: number): boolean {
    const now = this.options.now(), valid = Number.isFinite(now) && now >= this.lastMono;
    if (valid) this.lastMono = now;
    return valid && !this.disposed && admission.epoch === this.epoch && admission.serial === this.serial && this.options.context()?.generation === generation;
  }
  cancelDialogue(): void { this.epoch++; this.opening = undefined; this.cancelRead?.(); }
  invalidate(): void { this.cancelDialogue(); this.revision++; this.evidence = undefined; this.lastEvidence = ''; this.options.character.clearMusicInterests(); }
  reset(): void { this.invalidate(); this.lastWall = ''; this.nextSampleAt = this.options.now() + 300000; }
  dispose(): void { if (this.disposed) return; this.invalidate(); this.disposed = true; }
  private clock(): string | undefined {
    const now = this.options.timestamp();
    if (!Number.isFinite(Date.parse(now)) || new Date(now).toISOString() !== now || now < this.lastWall) return undefined;
    this.lastWall = now; return now;
  }
  async revalidate(deadline = this.options.now() + 200, settle = true, additive = false): Promise<boolean> {
    const context = this.options.context(), repository = this.options.repository, epoch = this.epoch;
    if (this.disposed || this.reading || !context || !repository || this.options.now() >= deadline) return false;
    const previous = this.evidence;
    this.reading = true; if (!additive) { this.evidence = undefined; this.options.character.clearMusicInterests(); }
    let published = false;
    let expired = false, timer: unknown;
    const read = (async () => {
      if (settle) await this.options.whenSettled?.();
      const now = this.clock();
      if (!now || expired || this.disposed || epoch !== this.epoch || this.options.context()?.generation !== context.generation) return;
      const result = await repository.read(now, context);
      if (expired || this.disposed || epoch !== this.epoch || this.options.context()?.generation !== context.generation || !result.ok) return;
      const key = JSON.stringify(result.value);
      const preservesProof = additive && previous && JSON.stringify(previous.userPreferences) === JSON.stringify(result.value.userPreferences)
        && musicCountsDoNotDecrease(previous.samples, result.value.samples);
      if (key !== this.lastEvidence) { this.lastEvidence = key; if (!preservesProof) this.revision++; }
      published = true;
      this.evidence = result.value; this.evidenceExpires = Math.min(...[...result.value.samples, ...result.value.userPreferences].map(row => Date.parse(row.occurredAt) + 30 * 86400000)); this.options.character.setMusicEvidence(result.value.samples);
    })().catch(() => {}).finally(() => { this.reading = false; });
    let cancel: (() => void) | undefined;
    const timeout = new Promise<void>(resolve => {
      cancel = () => { expired = true; this.options.scheduler.clearTimeout(timer); resolve(); };
      this.cancelRead = cancel;
      timer = this.options.scheduler.setTimeout(cancel, Math.max(0, deadline - this.options.now()));
    });
    try { await Promise.race([read, timeout]); return published; } finally { this.options.scheduler.clearTimeout(timer); if (this.cancelRead === cancel) this.cancelRead = undefined; if (!published) { this.revision++; this.evidence = undefined; this.options.character.clearMusicInterests(); } }
  }
  async persisted(turn: CompletedDialogueMemoryTurn, source: MusicDialogueSource, context: MemoryOperationContext): Promise<void> {
    const receipt: MusicPublishedReceipt | undefined = turn.musicReceipt, repository = this.options.repository;
    if (!receipt || !repository || this.disposed || receipt.admission.epoch !== this.epoch || this.options.context()?.generation !== context.generation || receipt.admission.serial <= this.persistedSerial) return;
    const monotonic = this.options.now();
    if (!Number.isFinite(monotonic) || monotonic < this.lastMono) return;
    this.lastMono = monotonic;
    this.persistedSerial = receipt.admission.serial;
    if (!receipt.success || turn.memoryConfirmable !== true) return;
    const { admission } = receipt, message = admission.message, now = this.clock();
    if (!message || !now) return;
    if (message.kind === 'preference') {
      const result = await this.safe(() => repository.replaceUserPreference({ topic: message.topic, disposition: message.disposition, source, occurredAt: turn.user.createdAt }, now, context));
      if (result.ok && admission.epoch === this.epoch) await this.revalidate(undefined, false);
    } else if (message.kind === 'opening' && receipt.discussionAllowed && receipt.dispatched && receipt.intention && admission.serial === this.serial
      && this.options.now() < admission.admittedAtMs + 300000) {
      this.opening = { source, topic: message.topic, conversationId: admission.conversationId, deadline: admission.admittedAtMs + 300000 };
    } else if (message.kind === 'continuation' && receipt.discussionAllowed && admission.opening && admission.openingDeadlineMs !== undefined && this.options.now() < admission.openingDeadlineMs && !this.appending && this.options.now() >= this.nextSampleAt) {
      this.nextSampleAt = this.options.now() + 300000; this.appending = true;
      try {
        const opening = admission.opening;
        const result = await this.safe(() => repository.appendSample({ topic: message.topic, intention: 'ask_music_detail', opening, continuation: source, occurredAt: turn.assistant.createdAt }, now, context));
        if (result.ok && admission.epoch === this.epoch) await this.revalidate(undefined, false, true);
      } finally { this.appending = false; }
    }
  }
  private async safe<T>(operation: () => Promise<MemoryResult<T>>): Promise<MemoryResult<T>> {
    try { return await operation(); } catch { return { ok: false, code: 'unavailable' }; }
  }
}
