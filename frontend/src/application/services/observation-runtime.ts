import { isObservationEligible } from '../../domain/behavior/local-activity-policy';
import type { ActiveApplicationObservationPort, ActiveApplicationObservationSnapshot, ObservationApplication } from '../ports/active-application-observation.port';
import type { IObservationProvider, ObservationProviderRequest } from '../ports/observation-provider.interface';
import type { MemoryScheduler } from '../ports/memory-runtime';
import type { AIInitiativeSpeechDTO, DialoguePresentationDTO } from '../../shared/ipc-contracts';
import type { ObservationSettingsDTO } from '../../shared/observation-contracts';
import { summaryPlainText } from '../../shared/summary-text-validation';
type Sample = Extract<ActiveApplicationObservationSnapshot, { capability: 'available' }>;
interface Options {
  readonly observer: ActiveApplicationObservationPort; readonly provider?: IObservationProvider;
  readonly now: () => number; readonly createId: () => string; readonly scheduler: MemoryScheduler;
  readonly character: () => ObservationProviderRequest['characterSnapshot']; readonly locale?: 'ru' | 'en';
  readonly gate: () => { readonly identity: string | null; readonly allowed: boolean; readonly busy: boolean; readonly higherSpeech: boolean };
  readonly spendBudget: (atMs: number) => boolean; readonly publish: () => void;
}
/** RAM-only consent, source barriers and lowest-priority optional speech. */
export class ObservationRuntime {
  private generation = 0;
  private enabled = false;
  private paused = false;
  private disposed = false;
  private applications: readonly ObservationApplication[] = [];
  private previewOpen = false;
  private sample: Sample | null = null;
  private dwell: { token: string; started: number; last: number; consumed: boolean } | null = null;
  private attemptedEpisode: string | null = null;
  private nextAttemptAt = 0;
  private epoch = 0;
  private pending: Promise<void> | null = null;
  private controller: AbortController | null = null;
  private speech: AIInitiativeSpeechDTO | null = null;
  private deadlineTimer: unknown;
  private speechTimer: unknown;
  private thinking = false;
  private dialogueGuardUntil = 0;
  private terminalDialogue: string | null = null;
  private readonly unsubscribe: () => void;
  constructor(private readonly options: Options) { this.unsubscribe = options.observer.subscribe(value => this.observe(value)); }
  getSettings(): ObservationSettingsDTO {
    const latest = this.options.observer.getSnapshot();
    const usable = !!this.options.provider && this.sample && this.fresh(this.sample);
    return { generation: this.generation, enabled: this.enabled, paused: this.paused,
      status: !this.enabled ? 'off' : this.paused ? 'paused' : usable ? 'available' : 'unavailable',
      reason: !this.enabled ? 'disabled' : this.paused ? 'paused' : !this.options.provider ? 'backend_unavailable' : latest.capability === 'unavailable' ? latest.reason : usable ? null : 'stale',
      applications: this.applications.map(app => ({ ...app })), previewOpen: this.previewOpen,
      preview: this.previewOpen && usable ? { appName: this.sample!.appName, windowTitle: this.sample!.windowTitle } : null };
  }
  addApplication(application: ObservationApplication): void {
    if (this.disposed || this.applications.some(app => app.appKey === application.appKey)) return;
    if (this.applications.length >= 32) throw new TypeError('Observation application limit');
    this.applications = [...this.applications, application]; this.replacePolicy();
  }
  removeApplication(appKey: string): void { this.applications = this.applications.filter(app => app.appKey !== appKey); this.replacePolicy(); }
  exclude(appKey: string, excluded: boolean): void { this.applications = this.applications.map(app => app.appKey === appKey ? { ...app, excluded } : app); this.replacePolicy(); }
  enable(): void { if (this.disposed) return; this.enabled = true; this.paused = false; this.replacePolicy(); }
  disable(): void { this.enabled = false; this.paused = false; this.replacePolicy(); }
  pause(): void { if (this.disposed) return; this.paused = this.enabled; this.replacePolicy(); }
  resume(): void { if (this.disposed || !this.enabled) return; this.paused = false; this.replacePolicy(); }
  clear(): void { this.enabled = false; this.paused = false; this.applications = []; this.replacePolicy(); }
  preview(open: boolean): void { this.previewOpen = open && !this.disposed; }
  private replacePolicy(): void {
    this.invalidate(); this.sample = null; this.dwell = null; this.previewOpen = false; this.generation++;
    this.options.observer.replacePolicy({ generation: this.generation, active: !!this.options.provider && this.enabled && !this.paused && !this.disposed, applications: this.applications });
  }
  private fresh(sample: Sample): boolean { const age = this.options.now() - sample.capturedAtMs; return age >= 0 && age <= 2500; }
  private observe(value: ActiveApplicationObservationSnapshot): void {
    if (this.disposed || value.policyGeneration !== this.generation) return;
    if (value.capability === 'unavailable') {
      this.sample = null; this.dwell = null; this.invalidate();
      if (this.enabled && !this.paused && ['paused', 'bridge_failed', 'permission_denied'].includes(value.reason)) this.pause();
      return;
    }
    if (!this.enabled || this.paused || !this.fresh(value) || (this.sample && value.revision <= this.sample.revision)) return;
    const changed = !this.sample || this.sample.appKey !== value.appKey || this.sample.episodeToken !== value.episodeToken || this.sample.sourceToken !== value.sourceToken;
    if (changed) { this.invalidate(); this.dwell = null; }
    this.sample = value;
    if (!this.dwell || this.dwell.token !== value.sourceToken || value.capturedAtMs - this.dwell.last > 1500 || value.capturedAtMs < this.dwell.last) {
      this.dwell = { token: value.sourceToken, started: value.capturedAtMs, last: value.capturedAtMs, consumed: false };
    } else this.dwell.last = value.capturedAtMs;
    this.tick();
  }
  observeDialogue(dialogue: DialoguePresentationDTO): void {
    this.thinking = dialogue.turn.phase === 'thinking';
    if (dialogue.turn.phase === 'completed' || dialogue.turn.phase === 'error') {
      const key = `${dialogue.conversationId}:${dialogue.turn.requestId}`;
      if (this.terminalDialogue !== key) { this.terminalDialogue = key; this.dialogueGuardUntil = this.options.now() + 5000; }
    }
    if (this.thinking || this.options.now() < this.dialogueGuardUntil) this.invalidate();
  }
  tick(): void {
    const sample = this.sample, gate = this.options.gate();
    if (!sample || !this.fresh(sample)) { this.sample = null; this.dwell = null; this.invalidate(); return; }
    if (!gate.allowed || gate.higherSpeech || this.thinking || this.options.now() < this.dialogueGuardUntil) this.invalidate();
    if (!this.dwell || this.dwell.consumed || sample.capturedAtMs - this.dwell.started < 30000) return;
    this.dwell.consumed = true;
    if (!this.options.provider || !this.options.provider.canStartObservation() || this.pending || !gate.identity || !isObservationEligible({ ...gate, thinking: this.thinking, dialogueGuard: this.options.now() < this.dialogueGuardUntil, budgetGuard: this.options.now() < this.nextAttemptAt }) || this.attemptedEpisode === sample.episodeToken) return;
    const epoch = this.epoch, identity = gate.identity, generation = this.generation, now = this.options.now();
    if (!this.options.spendBudget(now)) return;
    this.attemptedEpisode = sample.episodeToken; this.nextAttemptAt = now + 600000;
    const controller = new AbortController(); this.controller = controller;
    const requestId = this.options.createId();
    this.deadlineTimer = this.options.scheduler.setTimeout(() => { if (this.controller === controller) this.invalidate(); }, 3500);
    const execution = this.execute(sample, identity, generation, epoch, now + 3500, requestId, controller);
    this.pending = execution;
    void execution.finally(() => { if (this.pending === execution) this.pending = null; if (this.controller === controller) this.controller = null; });
  }
  private current(source: Sample, identity: string, generation: number, epoch: number, deadline: number): boolean {
    const latest = this.sample, gate = this.options.gate();
    return !this.disposed && this.enabled && !this.paused && generation === this.generation && epoch === this.epoch
      && latest !== null && this.fresh(latest) && latest.revision >= source.revision && latest.appKey === source.appKey
      && latest.episodeToken === source.episodeToken && latest.sourceToken === source.sourceToken && gate.identity === identity
      && gate.allowed && !gate.higherSpeech && !this.thinking && this.options.now() >= this.dialogueGuardUntil && this.options.now() < deadline;
  }
  private async execute(source: Sample, identity: string, generation: number, epoch: number, deadline: number, requestId: string, controller: AbortController): Promise<void> {
    try {
      if (!this.current(source, identity, generation, epoch, deadline) || !this.options.provider) return;
      const result = await this.options.provider.generateObservation({ requestId, locale: this.options.locale ?? 'ru', characterSnapshot: this.options.character(),
        observation: { appName: source.appName, windowTitle: source.windowTitle } }, controller.signal);
      if (!this.current(source, identity, generation, epoch, deadline)) return;
      const text = summaryPlainText(result, 240).trim(); if (text !== text.trim()) return;
      const startedAtMs = this.options.now();
      this.speech = { id: requestId, text, startedAtMs, expiresAtMs: startedAtMs + 2000 };
      this.speechTimer = this.options.scheduler.setTimeout(() => { if (this.speech?.id === requestId) { this.speech = null; this.options.publish(); } }, 2000);
      this.options.publish();
    } catch { /* Optional speech never produces an error bubble or retry. */ }
    finally { this.options.scheduler.clearTimeout(this.deadlineTimer); }
  }
  getSpeech(): AIInitiativeSpeechDTO | null { return this.speech && this.options.now() < this.speech.expiresAtMs ? this.speech : null; }
  isBusy(): boolean { return this.pending !== null; }
  invalidate(): void {
    this.epoch++; this.controller?.abort(); this.options.scheduler.clearTimeout(this.deadlineTimer); this.options.scheduler.clearTimeout(this.speechTimer);
    const changed = this.speech !== null; this.speech = null; if (changed) this.options.publish();
  }
  async interruptForUser(): Promise<void> { this.invalidate(); await this.pending; }
  reset(): void { this.dialogueGuardUntil = 0; this.terminalDialogue = null; this.pause(); }
  dispose(): void { if (this.disposed) return; this.disposed = true; this.replacePolicy(); this.unsubscribe(); this.options.observer.dispose(); }
}
