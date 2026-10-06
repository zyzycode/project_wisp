import type { DialogueCommandReceiptDTO } from '../shared/ipc-contracts';

interface Options {
  readonly register: (channel: string, handler: (event: { readonly sender: object }, payload: unknown) => Promise<DialogueCommandReceiptDTO>) => void;
  readonly remove: (channel: string) => void;
  readonly getSender: () => object | null;
  readonly receive: (payload: unknown) => DialogueCommandReceiptDTO;
}
export function registerDialogueIpc(options: Options): () => void {
  const channel = 'wisp:dialogue-command';
  options.register(channel, async (event, payload) => {
    const sender = options.getSender();
    if (sender === null || event.sender !== sender) throw new TypeError('Untrusted dialogue sender');
    return options.receive(payload);
  });
  return () => options.remove(channel);
}
