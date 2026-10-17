import type { Readable, Writable } from 'node:stream';
import type { ActiveApplicationObservationPort, ActiveApplicationObservationSnapshot, ObservationPolicy,
  ObservationUnavailableReason } from '../../application/ports/active-application-observation.port';
import { parseObservationResponse, type ObservationExecutable } from './active-application-protocol';

export interface ObservationHelperProcess {
  readonly stdin: Pick<Writable, 'write' | 'on'>;
  readonly stdout: Pick<Readable, 'on'>;
  readonly stderr: Pick<Readable, 'on'>;
  on(event: 'error' | 'exit', listener: () => void): unknown;
  kill(): unknown;
}
export interface ActiveApplicationObserverOptions {
  readonly now: () => number;
  readonly spawn: () => ObservationHelperProcess;
  readonly resolvePolicy: (policy: ObservationPolicy) => readonly ObservationExecutable[];
  readonly ownProcessIds: () => readonly number[];
  readonly unsupported?: boolean;
}
/** No startup before active consent; every terminal bridge failure requires a new explicit policy. */
export class ActiveApplicationObserver implements ActiveApplicationObservationPort {
  private snapshot: ActiveApplicationObservationSnapshot;
  private policy: ObservationPolicy = { generation: 0, active: false, applications: [] };
  private entries: readonly ObservationExecutable[] = [];
  private readonly listeners = new Set<(snapshot: ActiveApplicationObservationSnapshot) => void>();
  private child: ObservationHelperProcess | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private deadline: ReturnType<typeof setTimeout> | undefined;
  private expiry: ReturnType<typeof setTimeout> | undefined;
  private request: { id: number; startedAtMs: number } | undefined;
  private sequence = 0;
  private ready = false;
  private disposed = false;
  private buffer = Buffer.alloc(0);
  private lastPoll = Number.NEGATIVE_INFINITY;
  private lastSuccess: number | undefined;
  private sourceEpoch = 0;
  public constructor(private readonly options: ActiveApplicationObserverOptions) {
    this.snapshot = Object.freeze({ capability: 'unavailable', reason: options.unsupported ? 'unsupported' : 'disabled',
      policyGeneration: 0, revision: 0, capturedAtMs: options.now() });
  }
  public getSnapshot(): ActiveApplicationObservationSnapshot {
    const age = this.options.now() - this.snapshot.capturedAtMs;
    if (this.snapshot.capability === 'available' && (age < 0 || age > 2500)) this.unavailable('stale');
    return this.snapshot;
  }
  public subscribe(listener: (snapshot: ActiveApplicationObservationSnapshot) => void): () => void {
    if (!this.disposed) this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  public replacePolicy(policy: ObservationPolicy): void {
    if (this.disposed) return;
    // Validate completely before stopping the previous policy/session.
    const entries = this.options.resolvePolicy(policy);
    if (!Number.isSafeInteger(policy.generation) || policy.generation < this.policy.generation || entries.length > 32 ||
      entries.some(entry => entry.path.length > 1024) || Buffer.byteLength(JSON.stringify(entries), 'utf8') > 120 * 1024) {
      throw new Error('Invalid observation policy');
    }
    this.clear(); this.policy = policy; this.entries = entries; this.lastSuccess = undefined; this.sourceEpoch++;
    const active = policy.active && entries.some(entry => !entry.excluded);
    const generation = this.policy.generation;
    this.unavailable(this.options.unsupported ? 'unsupported' : active ? 'initializing' : 'disabled');
    if (active && !this.options.unsupported && this.policy.generation === generation) this.start();
  }
  public pause(): void {
    if (this.disposed) return;
    this.clear(); this.lastSuccess = undefined; this.sourceEpoch++;
    // Application receives this synchronously and owns the next policy generation.
    this.unavailable('paused');
  }
  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.clear(); this.entries = [];
    this.policy = { generation: this.policy.generation, active: false, applications: [] };
    this.unavailable('disabled'); this.listeners.clear();
  }
  private publish(snapshot: ActiveApplicationObservationSnapshot): void {
    this.snapshot = Object.freeze(snapshot);
    for (const listener of [...this.listeners]) listener(snapshot);
  }
  private unavailable(reason: ObservationUnavailableReason): void {
    clearTimeout(this.expiry);
    this.publish({ capability: 'unavailable', reason, policyGeneration: this.policy.generation,
      capturedAtMs: this.options.now(), revision: this.snapshot.revision + 1 });
  }
  private start(): void {
    try {
      const child = this.options.spawn(); this.child = child;
      child.stdout.on('data', (chunk: Buffer) => { if (this.child === child) this.receive(chunk); });
      child.stderr.on('data', () => {});
      child.stdin.on('error', () => { if (this.child === child) this.fail(); });
      child.on('error', () => { if (this.child === child) this.fail(); });
      child.on('exit', () => { if (this.child === child) this.fail(); });
      this.deadline = setTimeout(() => this.fail(), 10_000);
    } catch { this.fail(); }
  }
  private receive(chunk: Buffer): void {
    if (this.buffer.length + chunk.length > 4096) { this.fail(); return; }
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const newline = this.buffer.indexOf(10);
    if (newline < 0) return;
    // Exactly one newline-delimited envelope is accepted per in-flight operation.
    if (newline !== this.buffer.length - 1) { this.fail(); return; }
    const line = this.buffer.subarray(0, newline); this.buffer = Buffer.alloc(0);
    try {
      const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line));
      if (!this.ready) {
        if (JSON.stringify(value) !== '{"ready":true}') throw new Error('Invalid handshake');
        clearTimeout(this.deadline); this.ready = true; this.poll(); return;
      }
      const request = this.request;
      if (!request || this.options.now() - request.startedAtMs > 500 || this.options.now() < request.startedAtMs) throw new Error('Late sample');
      const result = parseObservationResponse(value, request.id, this.entries);
      clearTimeout(this.deadline); this.request = undefined;
      const child = this.child;
      if (!result.available) { this.lastSuccess = undefined; this.sourceEpoch++; this.unavailable(result.reason); }
      else {
        if (this.lastSuccess !== undefined && request.startedAtMs - this.lastSuccess > 1500) this.sourceEpoch++;
        this.lastSuccess = request.startedAtMs;
        const entry = this.entries.find(item => item.appKey === result.appKey)!;
        this.publish({ capability: 'available', policyGeneration: this.policy.generation, revision: this.snapshot.revision + 1,
          capturedAtMs: request.startedAtMs, appKey: result.appKey, appName: result.appName, windowTitle: result.windowTitle,
          episodeToken: result.episodeToken, sourceToken: `${this.sourceEpoch}-${result.sourceToken}`, category: entry.category });
        if (this.child === child && this.snapshot.capability === 'available') {
          clearTimeout(this.expiry);
          this.expiry = setTimeout(() => { this.getSnapshot(); }, Math.max(0, 2501 - (this.options.now() - request.startedAtMs)));
        }
      }
      if (this.child === child && child) this.schedule();
    } catch { this.fail(); }
  }
  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.poll(), Math.max(0, 1000 - (this.options.now() - this.lastPoll)));
  }
  private poll(): void {
    if (this.disposed || !this.ready || !this.child || this.request) return;
    const now = this.options.now();
    if (now - this.lastPoll < 1000) { this.schedule(); return; }
    this.lastPoll = now;
    try {
      const ownProcessIds = this.options.ownProcessIds();
      if (ownProcessIds.length === 0 || ownProcessIds.length > 512 || ownProcessIds.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error('Invalid identity');
      this.request = { id: ++this.sequence, startedAtMs: now };
      const payload = `${JSON.stringify({ id: this.sequence, entries: this.entries, ownProcessIds })}\n`;
      if (Buffer.byteLength(payload, 'utf8') > 128 * 1024) throw new Error('Oversized policy');
      this.deadline = setTimeout(() => this.fail(), 500);
      this.child.stdin.write(payload);
    } catch { this.fail(); }
  }
  private clear(): void {
    clearTimeout(this.timer); clearTimeout(this.deadline); clearTimeout(this.expiry);
    const child = this.child; this.child = undefined;
    this.request = undefined; this.ready = false; this.buffer = Buffer.alloc(0); child?.kill();
  }
  private fail(): void {
    this.clear(); this.lastSuccess = undefined; this.sourceEpoch++;
    if (!this.disposed) this.unavailable('bridge_failed');
  }
}
