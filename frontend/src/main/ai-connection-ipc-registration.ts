import { parseAIConnectionCommand, parseAIConnectionRead, parseAIConnectionResult, parseAIConnectionStatus } from '../shared/ai-connection-validation';
import type { AIConnectionController } from './ai-connection-controller';

interface Options {
  readonly register: (channel: string, handler: (event: { readonly sender: object }, ...args: unknown[]) => Promise<unknown>) => void;
  readonly remove: (channel: string) => void;
  readonly getSender: () => object | null;
  readonly getStream: () => string | null;
  readonly controller: AIConnectionController;
}
export function registerAIConnectionIpc(options: Options): () => void {
  options.register('wisp:ai-connection-read', async (event, ...args) => {
    if (!options.getSender() || event.sender !== options.getSender()) throw new TypeError('Untrusted AI connection sender');
    if (args.length !== 1) throw new TypeError('Invalid AI connection input');
    const command = parseAIConnectionRead(args[0]);
    if (command.streamId !== options.getStream()) throw new TypeError('Stale AI connection read');
    return parseAIConnectionStatus(options.controller.read());
  });
  options.register('wisp:ai-connection-configure', async (event, ...args) => {
    if (!options.getSender() || event.sender !== options.getSender()) throw new TypeError('Untrusted AI connection sender');
    let command;
    try {
      if (args.length !== 1) throw new TypeError('Invalid AI connection input');
      command = parseAIConnectionCommand(args[0]);
    } catch { return { ok: false, code: 'invalid_input' }; }
    if (command.streamId !== options.getStream()) return { ok: false, code: 'stale' };
    const result = await options.controller.configure(command);
    if (command.streamId !== options.getStream() || event.sender !== options.getSender()) return { ok: false, code: 'stale' };
    return parseAIConnectionResult(result);
  });
  return () => { options.remove('wisp:ai-connection-read'); options.remove('wisp:ai-connection-configure'); };
}
