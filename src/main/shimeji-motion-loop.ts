export interface MotionLoopOrchestrator {
  start(): void;
  stop(): void;
  tick(): boolean;
}

export interface MotionLoopWindow {
  isDestroyed(): boolean;
}

export interface MotionLoopTimer {
  setInterval(callback: () => void, intervalMs: number): ReturnType<typeof setInterval>;
  clearInterval(handle: ReturnType<typeof setInterval>): void;
}

export interface ShimejiMotionLoopOptions {
  readonly orchestrator: MotionLoopOrchestrator;
  readonly getWindow: () => MotionLoopWindow | null;
  readonly publishPresentation: () => void;
  readonly intervalMs: number;
  readonly timer?: MotionLoopTimer;
}

/** Starts the Main-owned loop and returns its idempotent lifecycle stop function. */
export function startShimejiMotionLoop(options: ShimejiMotionLoopOptions): () => void {
  const timer = options.timer ?? { setInterval, clearInterval };
  let stopped = false;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    timer.clearInterval(handle);
    options.orchestrator.stop();
  };
  const handle = timer.setInterval(() => {
    const window = options.getWindow();
    if (window === null || window.isDestroyed()) {
      stop();
      return;
    }
    if (options.orchestrator.tick()) options.publishPresentation();
  }, options.intervalMs);
  options.orchestrator.start();
  return stop;
}
