import type { CurrentComputerContext } from '../ports/world-context.interface';

interface Sample {
  readonly appKey: string;
  readonly episodeToken: string;
  readonly revision: number;
  readonly capturedAtMs: number;
}
interface ContinuousSource extends Sample { readonly firstSampleAtMs: number; }

/** RAM-only normalization of an already authorized observer stream. */
export class ForegroundContextTracker {
  private generation = 0;
  private source: ContinuousSource | null = null;
  private revision = -1;
  private sampledAtMs = 0;
  private lastNow: number | null = null;

  reset(): void { this.generation++; this.source = null; this.revision = -1; this.lastNow = null; }
  invalidate(): void { if (this.source) this.generation++; this.source = null; }

  observe(sample: Sample, nowMs: number): void {
    if (!this.clock(nowMs) || !Number.isSafeInteger(sample.revision) || sample.revision < 0
      || !Number.isFinite(sample.capturedAtMs) || sample.capturedAtMs < 0
      || nowMs - sample.capturedAtMs < 0 || nowMs - sample.capturedAtMs > 2500
      || !sample.appKey.trim() || !sample.episodeToken.trim()) { this.invalidate(); return; }
    if (sample.revision <= this.revision) { this.invalidate(); return; }
    this.revision = sample.revision; this.sampledAtMs = sample.capturedAtMs;
    const previous = this.source;
    if (previous && (sample.capturedAtMs <= previous.capturedAtMs || sample.capturedAtMs - previous.capturedAtMs > 1500)) {
      this.invalidate(); return;
    }
    if (!previous || previous.appKey !== sample.appKey || previous.episodeToken !== sample.episodeToken) {
      this.generation++; this.source = this.continuous(sample, sample.capturedAtMs); return;
    }
    this.source = this.continuous(sample, previous.firstSampleAtMs);
  }

  current(nowMs: number, presence: CurrentComputerContext['presence']): CurrentComputerContext {
    if (!this.clock(nowMs) || (this.source && nowMs - this.source.capturedAtMs > 2500)) this.invalidate();
    return { generation: this.generation, sampledAtMs: this.sampledAtMs, presence,
      foreground: !this.source ? 'unknown' : nowMs - this.source.firstSampleAtMs >= 3000 ? 'stable' : 'settling' };
  }

  private clock(nowMs: number): boolean {
    const valid = Number.isFinite(nowMs) && nowMs >= 0 && (this.lastNow === null || nowMs >= this.lastNow);
    if (!valid) this.invalidate();
    this.lastNow = Number.isFinite(nowMs) && nowMs >= 0 ? nowMs : null;
    return valid;
  }

  private continuous(sample: Sample, firstSampleAtMs: number): ContinuousSource {
    return { appKey: sample.appKey, episodeToken: sample.episodeToken, revision: sample.revision,
      capturedAtMs: sample.capturedAtMs, firstSampleAtMs };
  }
}
