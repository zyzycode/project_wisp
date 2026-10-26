import type { BrainStateDTO, WispApiBridge, InterestThreadRefDTO } from '../shared/ipc-contracts';
import { parseDialogueReceipt } from '../shared/dialogue-ipc-validation';

type Bridge = Pick<WispApiBridge, 'postDialogueCommand'>;
/** Document-local command ordering and transport state; all dialogue state comes from Brain. */
export class DialogueCommandClient {
  private snapshot: BrainStateDTO | null = null;
  private sequence = 0;
  private beverageProposal = false;
  public requestBeverageProposal(): void { this.beverageProposal = true; this.notify(); }
  public cancelBeverageProposal(): void { this.beverageProposal = false; this.notify(); }
  private topic: { ref: InterestThreadRefDTO; text: string } | null = null;
  public selectTopic(ref: InterestThreadRefDTO, text: string): void { this.topic = { ref, text }; this.notify(); }
  public cancelTopic = (): void => { this.topic = null; this.notify(); };
  private retiredStreams = new Set<string>();
  private pending: object | null = null;
  private error: string | null = null;
  private listeners = new Set<() => void>();
  constructor(private readonly bridge: Bridge) {}
  public subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  public getState(): { canSubmit: boolean; error: string | null; submissionMessage?: string; replyTopic?: string; beverageProposal?: true } {
    const submissionMessage = this.snapshot?.dialogue.submissionMessage;
    return { ...(this.beverageProposal ? { beverageProposal: true as const } : {}), ...(this.topic ? { replyTopic: this.topic.text } : {}), canSubmit: this.pending === null && this.snapshot?.dialogue.canSubmit === true, error: this.error,
      ...(submissionMessage === undefined ? {} : { submissionMessage }) };
  }
  public isCurrent(snapshot: BrainStateDTO): boolean { return snapshot.streamId === this.snapshot?.streamId && snapshot.revision === this.snapshot.revision; }
  public accept(snapshot: BrainStateDTO): void {
    if (this.retiredStreams.has(snapshot.streamId)) return;
    if (snapshot.streamId === this.snapshot?.streamId && snapshot.revision <= this.snapshot.revision) return;
    if (snapshot.streamId !== this.snapshot?.streamId) {
      if (this.snapshot) this.retiredStreams.add(this.snapshot.streamId);
      this.beverageProposal = false; this.topic = null; this.sequence = 0; this.pending = null; this.error = null;
    }
    if (snapshot.dialogue.conversationId !== this.snapshot?.dialogue.conversationId) { this.beverageProposal = false; this.topic = null; this.pending = null; this.error = null; }
    this.snapshot = snapshot; this.notify();
  }
  public async send(text: string): Promise<boolean> {
    const snapshot = this.snapshot;
    if (!snapshot || !this.getState().canSubmit) return false;
    const token = {}; this.pending = token; this.error = null; this.notify();
    try {
      const receipt = parseDialogueReceipt(await this.bridge.postDialogueCommand({ type: 'send', text, ...(this.beverageProposal ? { requestBeverageProposal: true as const } : {}), ...(this.topic ? { replyToInterestThread: this.topic.ref } : {}),
        streamId: snapshot.streamId, conversationId: snapshot.dialogue.conversationId, sequence: ++this.sequence }));
      if (this.pending !== token || this.snapshot?.streamId !== snapshot.streamId) return false;
      if (receipt.status === 'accepted') { this.beverageProposal = false; this.topic = null; return true; }
      this.error = receipt.reason === 'busy' ? 'Подожди, я ещё отвечаю.' : 'Сообщение не принято. Попробуй ещё раз.';
      return false;
    } catch {
      if (this.pending === token) this.error = 'Не удалось отправить сообщение. Попробуй ещё раз.';
      return false;
    } finally {
      if (this.pending === token) { this.pending = null; this.notify(); }
    }
  }
  private notify(): void { for (const listener of this.listeners) listener(); }
}
const clients = new WeakMap<Bridge, DialogueCommandClient>();
export function getDialogueCommandClient(bridge: Bridge): DialogueCommandClient {
  let client = clients.get(bridge);
  if (!client) { client = new DialogueCommandClient(bridge); clients.set(bridge, client); }
  return client;
}
