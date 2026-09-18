import type { BrainStateDTO } from '../shared/ipc-contracts';
import { createChatMessage, type ChatMessage } from '../domain/chat/chat-message';

/** Dedupe presentation identities; never decides a game outcome or a reply. */
export class SpeechProjection {
  private stream: string | null = null;
  private dialogue: string | null = null;
  private game: string | null = null;
  private initiative: string | null = null;
  private owner: 'dialogue' | 'game' | 'initiative' | null = null;
  public accept(snapshot: BrainStateDTO): ChatMessage | null | undefined {
    const changedStream = this.stream !== snapshot.streamId;
    if (changedStream) { this.stream = snapshot.streamId; this.dialogue = null; this.game = null; this.initiative = null; this.owner = null; }
    const turn = snapshot.dialogue.turn;
    if (turn.phase === 'thinking') {
      if (this.owner === 'game' || this.owner === 'initiative') { this.owner = null; return null; }
      return changedStream ? null : undefined;
    }
    const dialogueKey = turn.phase === 'completed' || turn.phase === 'error'
      ? `${snapshot.dialogue.conversationId}:${turn.requestId}` : null;
    if (dialogueKey !== null && this.dialogue !== dialogueKey) {
      this.dialogue = dialogueKey; this.owner = 'dialogue';
      return createChatMessage('pet', turn.phase === 'completed' ? turn.replyText : turn.phase === 'error' ? turn.message : '',
        dialogueKey, snapshot.sampledAtMs);
    }
    const speech = snapshot.cursorGame?.speech;
    if (speech && speech.expiresAtMs > snapshot.sampledAtMs && this.game !== speech.id) {
      this.game = speech.id; this.owner = 'game';
      return { id: `${snapshot.streamId}:${speech.id}`, sender: 'pet', text: speech.text,
        timestamp: speech.startedAtMs, durationMs: speech.expiresAtMs - snapshot.sampledAtMs };
    }
    const initiative = snapshot.initiativeSpeech;
    if (!speech && initiative && initiative.expiresAtMs > snapshot.sampledAtMs && this.initiative !== initiative.id) {
      this.initiative = initiative.id; this.owner = 'initiative';
      return { id: `${snapshot.streamId}:${initiative.id}`, sender: 'pet', text: initiative.text,
        timestamp: initiative.startedAtMs, durationMs: initiative.expiresAtMs - snapshot.sampledAtMs };
    }
    if ((!initiative && this.owner === 'initiative') || (!speech && this.owner === 'game') || (turn.phase === 'idle' && this.owner === 'dialogue') || changedStream) {
      this.owner = null; return null;
    }
    return undefined;
  }
}
