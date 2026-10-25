import type { IQuietSupportRuntime } from '../ports/dialogue-runtime';

/** One Main-session latch, independent of manual quiet and dialogue streams. */
export class QuietSupportRuntime implements IQuietSupportRuntime {
  private active = false;
  private disposed = false;
  constructor(private readonly suppressUnsolicited: () => void) {}
  isActive(): boolean { return this.active; }
  enter(): void { if (this.disposed || this.active) return; this.active = true; this.suppressUnsolicited(); }
  resumeForUserDialogue(): void { if (!this.disposed) this.active = false; }
  resetMemory(): void { this.active = false; }
  dispose(): void { this.active = false; this.disposed = true; }
}

export const LOCAL_DIALOGUE_TEXT = {
  support_quiet_ack: { ru: 'Поняла. Я рядом.', en: "I understand. I'm here." },
};
export function isQuietSupportCue(text: string): boolean {
  const normalized = text.normalize('NFC').trim().toLowerCase().replace(/’/gu, "'").replace(/[.!?\s]+$/gu, '');
  return normalized === 'мне от этого не легче' || normalized === "that doesn't make me feel better";
}
