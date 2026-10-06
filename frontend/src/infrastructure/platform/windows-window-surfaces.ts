import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { ExternalWindowSurfacesPort, ExternalWindowSurfacesSnapshot } from '../../application/ports/external-window-surfaces.port';
import type { ExternalWindowSurface } from '../../domain/behavior/surface-kinematics';
import { parseBridgeResponse, type BridgeWindow } from './window-surfaces-protocol';

const MAX_RESPONSE_BYTES = 256 * 1024;
export interface WindowsWindowSurfacesOptions {
  readonly now: () => number;
  readonly spawn: () => ChildProcessWithoutNullStreams;
  readonly ownProcessIds: () => readonly number[];
  readonly normalize: (windows: readonly BridgeWindow[]) => readonly ExternalWindowSurface[];
  readonly cleanup?: () => void;
}

/** One helper, one request in flight; helper output is never logged or propagated. */
export class WindowsWindowSurfaces implements ExternalWindowSurfacesPort {
  private snapshot: ExternalWindowSurfacesSnapshot;
  private readonly listeners = new Set<(snapshot: ExternalWindowSurfacesSnapshot) => void>();
  private child: ChildProcessWithoutNullStreams | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private deadline: ReturnType<typeof setTimeout> | undefined;
  private request: { id: number; startedAtMs: number } | undefined;
  private sequence = 0;
  private ready = false;
  private disposed = false;
  private buffer = Buffer.alloc(0);
  private lastPollAtMs = Number.NEGATIVE_INFINITY;

  public constructor(private readonly options: WindowsWindowSurfacesOptions) {
    this.snapshot = Object.freeze({ capability: 'unavailable', reason: 'initializing', surfaces: Object.freeze([] as const), capturedAtMs: options.now(), revision: 0 });
    this.start();
  }
  public getSnapshot(): ExternalWindowSurfacesSnapshot {
    const age = this.options.now() - this.snapshot.capturedAtMs;
    if (this.snapshot.capability === 'available' && (age < 0 || age > 300)) this.unavailable('stale');
    return this.snapshot;
  }
  public subscribe(listener: (snapshot: ExternalWindowSurfacesSnapshot) => void): () => void {
    if (!this.disposed) this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  public invalidate(): void {
    if (this.disposed) return;
    // Topology/DPI changes kill the in-flight request and its identity epoch.
    this.fail();
  }
  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clear();
    this.unavailable('bridge_failed');
    this.listeners.clear();
    this.options.cleanup?.();
  }
  private publish(snapshot: ExternalWindowSurfacesSnapshot): void {
    this.snapshot = Object.freeze(snapshot);
    for (const listener of this.listeners) listener(this.snapshot);
  }
  private unavailable(reason: 'initializing' | 'bridge_failed' | 'stale'): void {
    this.publish({ capability: 'unavailable', reason, surfaces: Object.freeze([]),
      capturedAtMs: this.snapshot.capturedAtMs, revision: this.snapshot.revision + 1 });
  }
  private start(): void {
    if (this.disposed) return;
    this.ready = false;
    this.buffer = Buffer.alloc(0);
    try {
      const child = this.options.spawn();
      this.child = child;
      child.stdout.on('data', (chunk: Buffer) => { if (this.child === child) this.receive(chunk); });
      // Drain diagnostics without retaining potentially private/native details.
      child.stderr.on('data', () => {});
      child.stdin.on('error', () => { if (this.child === child) this.fail(); });
      child.on('error', () => { if (this.child === child) this.fail(); });
      child.on('exit', () => { if (this.child === child) this.fail(); });
      this.deadline = setTimeout(() => this.fail(), 10_000); // Add-Type startup; no observation is available yet.
    } catch { this.fail(); }
  }
  private receive(chunk: Buffer): void {
    if (this.buffer.length + chunk.length > MAX_RESPONSE_BYTES) { this.fail(); return; }
    this.buffer = Buffer.concat([this.buffer, chunk]);
    let newline: number;
    while ((newline = this.buffer.indexOf(10)) >= 0) {
      const line = this.buffer.subarray(0, newline).toString('utf8').trim();
      this.buffer = this.buffer.subarray(newline + 1);
      try {
        const message: unknown = JSON.parse(line);
        if (!this.ready) {
          if (JSON.stringify(message) !== '{"ready":true}') throw new Error('Invalid ready');
          clearTimeout(this.deadline); this.ready = true; this.poll();
        } else {
          const request = this.request;
          if (request === undefined || this.options.now() - request.startedAtMs > 250 || this.options.now() < request.startedAtMs) throw new Error('Late response');
          const records = parseBridgeResponse(message, request.id);
          const surfaces = this.options.normalize(records);
          clearTimeout(this.deadline); this.request = undefined;
          this.publish({ capability: 'available', capturedAtMs: request.startedAtMs, revision: this.snapshot.revision + 1, surfaces });
          this.schedule();
        }
      } catch { this.fail(); return; }
    }
  }
  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.poll(), Math.max(0, 100 - (this.options.now() - this.lastPollAtMs)));
  }
  private poll(): void {
    if (this.disposed || !this.ready || this.child === undefined || this.request !== undefined) return;
    const now = this.options.now();
    if (now - this.lastPollAtMs < 100) { this.schedule(); return; }
    this.lastPollAtMs = now;
    this.request = { id: ++this.sequence, startedAtMs: now };
    this.deadline = setTimeout(() => this.fail(), 250);
    try {
      const ids = this.options.ownProcessIds();
      if (ids.length === 0 || ids.length > 512 || ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error('Invalid own processes');
      this.child.stdin.write(`${this.request.id} ${ids.join(',')}\n`);
    } catch { this.fail(); }
  }
  private clear(): void {
    clearTimeout(this.timer); clearTimeout(this.deadline);
    const child = this.child; this.child = undefined;
    this.request = undefined; this.ready = false; this.buffer = Buffer.alloc(0);
    child?.kill();
  }
  private fail(): void {
    this.clear();
    if (this.disposed) return;
    this.unavailable('bridge_failed');
    this.timer = setTimeout(() => this.start(), 1000);
  }
}
