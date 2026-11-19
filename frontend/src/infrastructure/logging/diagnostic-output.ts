import type { Writable } from 'node:stream';

export type DiagnosticRecord = Readonly<Record<string, unknown>>;
export type DiagnosticWritable = Pick<Writable, 'write' | 'on' | 'removeListener'>;

/** One best-effort output boundary; no application queue while the stream is blocked. */
export class DiagnosticOutput {
  private blocked = false;
  private disabled = false;
  private retired = false;
  private pending = 0;
  private readonly drain = () => { this.blocked = false; };
  private readonly error = () => {
    this.disabled = true;
    if (this.retired) this.stream.removeListener('error', this.error);
  };
  constructor(private readonly stream: DiagnosticWritable) {
    stream.on('drain', this.drain);
    stream.on('error', this.error);
  }
  public write(record: DiagnosticRecord): void {
    if (this.disabled || this.blocked) return;
    let pending = false;
    const complete = (error?: Error | null) => {
      if (!pending) return;
      pending = false; this.pending--;
      // Writable emits its error after invoking the write callback; retain the guard until that event.
      if (this.retired && this.pending === 0 && !error) this.stream.removeListener('error', this.error);
    };
    try {
      const line = `${JSON.stringify({ ...record, timestamp: new Date().toISOString() })}\n`;
      if (Buffer.byteLength(line) > 4096) return;
      pending = true; this.pending++;
      this.blocked = !this.stream.write(line, complete);
    } catch { this.disabled = true; complete(); }
  }
  public dispose(): void {
    this.disabled = true; this.retired = true;
    this.stream.removeListener('drain', this.drain);
    if (this.pending === 0) this.stream.removeListener('error', this.error);
  }
}
