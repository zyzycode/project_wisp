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
  readonly advanceBrain?: () => boolean;
  /** Same interval, semantic capture only while no presentation window exists. */
  readonly advanceBackgroundSampling?: () => void;
  readonly publishPresentation: () => void;
  readonly beginPresentationTransaction?: () => void;
  readonly commitPresentationTransaction?: () => void;
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
    if (stopped) return;
    const window = options.getWindow();
    if (window === null || window.isDestroyed()) {
      if (options.advanceBackgroundSampling) { options.advanceBackgroundSampling(); return; }
      stop();
      return;
    }
    options.beginPresentationTransaction?.();
    try {
      const motionChanged = options.orchestrator.tick();
      const brainChanged = options.advanceBrain?.() ?? false;
      if (motionChanged || brainChanged) options.publishPresentation();
    } finally {
      options.commitPresentationTransaction?.();
    }
  }, options.intervalMs);
  const window = options.getWindow();
  if (!options.advanceBackgroundSampling || (window !== null && !window.isDestroyed())) options.orchestrator.start();
  return stop;
}
