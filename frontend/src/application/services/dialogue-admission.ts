import type { MemoryScheduler } from '../ports/memory-runtime';
/** A timed-out group keeps its slot until settlement, preventing a growing read queue. */
export class DialogueAdmission {
  private unsettled = false;
  constructor(private readonly now: () => number, private readonly scheduler: MemoryScheduler) {}
  async run<T>(deadline: number, work: () => Promise<T>): Promise<T | undefined> {
    if (this.unsettled || this.now() >= deadline) return undefined;
    this.unsettled = true;
    let timer: unknown;
    const pending = Promise.resolve().then(work).finally(() => { this.unsettled = false; });
    const timeout = new Promise<undefined>(resolve => { timer = this.scheduler.setTimeout(() => resolve(undefined), Math.max(0, deadline - this.now())); });
    try { return await Promise.race([pending, timeout]); } finally { this.scheduler.clearTimeout(timer); }
  }
}
