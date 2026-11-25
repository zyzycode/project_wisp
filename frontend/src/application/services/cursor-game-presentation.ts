import type { CursorGamePresentationDTO, DialoguePresentationDTO } from '../../shared/ipc-contracts';
import type { CursorGameOutcome } from '../ports/cursor-game-contract';

const TEXT = {
  ru: { attempt: 'Стой, я почти поймала!', caught: 'Поймала!', missed: 'В этот раз ты быстрее.', lost_target: 'Куда ты делся?' },
  en: { attempt: 'Wait, I almost caught you!', caught: 'Caught you!', missed: 'You were faster this time.', lost_target: 'Where did you go?' },
};
/** Main time controls speech lifetime; missed lines are never queued. */
export class CursorGamePresentation {
  private value: CursorGamePresentationDTO | null = null;
  private seen = new Set<string>();
  private runId: string | null = null;
  private sequence = 0;
  private active = false;
  private conversation: string | null = null;
  private dialogueKey: string | null = null;
  private thinking = false;
  private guardUntil = 0;
  public constructor(private readonly now: () => number, private readonly locale: () => 'ru' | 'en' = () => 'ru') {}
  public phase(runId: string, phase: string, outcome: CursorGameOutcome | null): void {
    this.active = phase !== 'terminal';
    if (this.runId !== runId) { this.runId = runId; this.value = { runId, outcome, speech: null }; this.seen.clear(); }
    if (!this.value) this.value = { runId, outcome, speech: null };
    const key = outcome && outcome !== 'cancelled' ? outcome : phase === 'attempt' ? 'attempt' : null;
    const prior = this.value;
    this.value = { ...prior, outcome };
    if (key === null || this.seen.has(key)) return;
    this.seen.add(key);
    if (this.thinking || this.now() < this.guardUntil) return;
    const at = this.now();
    this.value = { runId, outcome, speech: { id: `cursor-speech-${++this.sequence}`, text: TEXT[this.locale()][key],
      startedAtMs: at, expiresAtMs: at + 2000 } };
  }
  public terminal(runId: string, outcome: CursorGameOutcome): void {
    if (outcome === 'cancelled') { this.clear(); return; }
    this.phase(runId, 'terminal', outcome);
    if (this.value?.speech === null) this.clear();
  }
  public observeDialogue(dialogue: DialoguePresentationDTO): void {
    if (this.conversation !== dialogue.conversationId) {
      this.clear(); this.guardUntil = 0; this.dialogueKey = null; this.conversation = dialogue.conversationId;
    }
    const turn = dialogue.turn;
    this.thinking = turn.phase === 'thinking';
    if (this.thinking && this.value) this.value = { ...this.value, speech: null };
    if (turn.phase === 'completed' || turn.phase === 'error') {
      const key = `${dialogue.conversationId}:${turn.requestId}`;
      if (key !== this.dialogueKey) { this.dialogueKey = key; this.guardUntil = this.now() + 5000;
        if (this.value) this.value = { ...this.value, speech: null }; }
    }
  }
  public tick(): boolean {
    if (this.value?.speech && this.now() >= this.value.speech.expiresAtMs) {
      this.value = this.active ? { ...this.value, speech: null } : null;
      return true;
    }
    return false;
  }
  public clear(): void { this.value = null; }
  public reset(): void { this.clear(); this.runId = null; this.seen.clear(); this.conversation = null; this.dialogueKey = null; this.thinking = false; this.guardUntil = 0; }
  public get(): CursorGamePresentationDTO | null { return this.value; }
}
