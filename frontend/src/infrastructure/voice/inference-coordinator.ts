import { availableParallelism } from 'node:os';

export function voiceCpuBudget(parallelism = availableParallelism()) {
  const budget = Math.max(1, Math.min(8, Math.floor(parallelism) - 1));
  return Object.freeze({ sttThreads: Math.min(2, budget), ttsThreads: budget });
}
export function voiceSessionOptions(threads: number, spinning = false) {
  if (!Number.isInteger(threads) || threads < 1 || threads > 8) throw new Error('Invalid speech CPU budget');
  const enabled = spinning ? '1' : '0';
  return { intraOpNumThreads: threads, interOpNumThreads: 1,
    extra: { session: { intra_op: { allow_spinning: enabled }, inter_op: { allow_spinning: enabled } } } };
}
type Release = () => void;
/** Main-owned native admission, not an audio queue or an OS core reservation. */
export class VoiceInferenceCoordinator {
  readonly cpu = voiceCpuBudget();
  private held = false;
  private waiter?: () => void;
  public tryAcquire(): Release | null {
    if (this.held) return null;
    this.held = true;
    let released = false;
    return () => {
      if (released) return;
      released = true; this.held = false; this.waiter?.();
    };
  }
  public acquire(signal: AbortSignal, deadline: number): Promise<Release> {
    if (signal.aborted || performance.now() >= deadline || this.waiter) return Promise.reject(new Error('Speech admission unavailable'));
    const immediate = this.tryAcquire();
    if (immediate) return Promise.resolve(immediate);
    return new Promise((resolve, reject) => {
      const clear = () => { clearTimeout(timer); signal.removeEventListener('abort', cancel); if (this.waiter === grant) this.waiter = undefined; };
      const cancel = () => { clear(); reject(new Error('Speech admission cancelled')); };
      const grant = () => {
        if (signal.aborted || performance.now() >= deadline) { cancel(); return; }
        const release = this.tryAcquire();
        if (release) { clear(); resolve(release); }
      };
      const timer = setTimeout(cancel, Math.max(0, deadline - performance.now()));
      this.waiter = grant; signal.addEventListener('abort', cancel, { once: true });
    });
  }
}
