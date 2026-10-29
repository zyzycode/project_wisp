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
  submit(reply: ReplyPresentation): void;
  clear(): void;
  dispose(): void;
}

export class TextReplyOutput implements IReplyOutput {
  constructor(private readonly display: (message: ChatMessage | null) => void) {}
  public submit(reply: ReplyPresentation): void {
    this.display(createChatMessage('pet', reply.text, `${reply.conversationId}:${reply.requestId}`, reply.presentedAtMs));
  }
  public clear(): void { this.display(null); }
  public dispose(): void { this.clear(); }
}
export class ReplyOutputs implements IReplyOutput {
  constructor(private readonly channels: readonly IReplyOutput[]) {}
  public submit(reply: ReplyPresentation): void { for (const channel of this.channels) channel.submit(reply); }
  public clear(): void { for (const channel of this.channels) channel.clear(); }
  public dispose(): void { for (const channel of this.channels) channel.dispose(); }
}
