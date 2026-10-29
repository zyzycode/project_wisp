import type { ChatMessage } from '../domain/chat/chat-message';
import { createChatMessage } from './render-engine/chat-message-presentation';
export interface ReplyPresentation {
  readonly streamId: string;
  readonly conversationId: string;
  readonly requestId: string;
  readonly text: string;
  readonly presentedAtMs: number;
}
export interface IReplyOutput {
  submit(reply: ReplyPresentation): ReplyOutputOutcome | Promise<ReplyOutputOutcome>;
  clear(): void;
  dispose(): void;
}
export type ReplyOutputOutcome = 'presented' | 'failed' | 'cancelled';

export class TextReplyOutput implements IReplyOutput {
  constructor(private readonly display: (message: ChatMessage | null) => void) {}
  public submit(reply: ReplyPresentation): ReplyOutputOutcome {
    this.display(createChatMessage('pet', reply.text, `${reply.conversationId}:${reply.requestId}`, reply.presentedAtMs));
    return 'presented';
  }
  public clear(): void { this.display(null); }
  public dispose(): void { this.clear(); }
}
interface OutputChannels {
  readonly text: IReplyOutput;
  readonly voice: IReplyOutput;
  readonly voiceEnabled: () => boolean;
}
/** Select one channel per reply; only a current voice failure can fall back to text. */
export class ReplyOutputRouter implements IReplyOutput {
  private generation = 0;
  private disposed = false;
  constructor(private readonly channels: OutputChannels) {}
  public async submit(reply: ReplyPresentation): Promise<ReplyOutputOutcome> {
    if (this.disposed) return 'cancelled';
    const generation = ++this.generation;
    if (!this.channels.voiceEnabled()) return this.channels.text.submit(reply);
    this.channels.text.clear();
    let outcome: ReplyOutputOutcome;
    try { outcome = await this.channels.voice.submit(reply); }
    catch { outcome = 'failed'; }
    if (this.disposed || generation !== this.generation) return 'cancelled';
    return outcome === 'failed' ? this.channels.text.submit(reply) : outcome;
  }
  public clear(): void { this.generation++; this.channels.text.clear(); this.channels.voice.clear(); }
  public dispose(): void { this.disposed = true; this.clear(); this.channels.text.dispose(); this.channels.voice.dispose(); }
}
