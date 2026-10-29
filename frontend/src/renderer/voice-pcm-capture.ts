/** Area-average downsampling preserves continuity across browser audio blocks. */
export class MonoPcmCollector {
  private readonly samples: number[] = [];
  private weight = 0;
  private sum = 0;
  constructor(private readonly sampleRate: number, private readonly limit = 480_000) {}
  append(input: Float32Array): boolean {
    const width = this.sampleRate / 16_000;
    for (const sample of input) {
      let remaining = 1;
      while (remaining > 0 && this.samples.length < this.limit) {
        const take = Math.min(remaining, width - this.weight);
        this.sum += (Number.isFinite(sample) ? Math.max(-1, Math.min(1, sample)) : 0) * take;
        this.weight += take;
        remaining -= take;
        if (this.weight >= width - 1e-9) {
          this.samples.push(this.sum / width);
          this.sum = 0;
          this.weight = 0;
        }
      }
      if (this.samples.length >= this.limit) return true;
    }
    return false;
  }
  take(): readonly number[] { return this.samples.splice(0); }
}
