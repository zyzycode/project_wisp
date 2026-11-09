import type { IWindowFocusControls } from '../application/ports/window-focus-controls.interface';
import { parseWindowFocusChoose, parseWindowFocusOpen, parseWindowFocusResult } from '../shared/window-focus-validation';
interface Options {
  readonly register: (channel: string, handler: (event: { readonly sender: object }, ...args: unknown[]) => Promise<unknown>) => void;
  readonly remove: (channel: string) => void;
  readonly getSender: () => object | null;
  readonly controls: () => IWindowFocusControls | undefined;
}
/** Only the main pet renderer can request the native selection confirmation. */
export function registerWindowFocusIpc(options: Options): () => void {
  const handlers = {
    'wisp:window-focus-read': async (value: unknown) => options.controls()?.read(parseWindowFocusOpen(value)),
    'wisp:window-focus-open': async (value: unknown) => options.controls()?.open(parseWindowFocusOpen(value)),
    'wisp:window-focus-choose': async (value: unknown) => options.controls()?.choose(parseWindowFocusChoose(value)),
    'wisp:window-focus-cancel': async (value: unknown) => options.controls()?.cancel(parseWindowFocusOpen(value)),
  };
  for (const [channel, handler] of Object.entries(handlers)) options.register(channel, async (event, ...args) => {
    const sender = options.getSender();
    if (!sender || sender !== event.sender) throw new TypeError('Untrusted focus sender');
    try {
      if (args.length !== 1) throw new TypeError('Invalid focus input');
      return parseWindowFocusResult(await handler(args[0]) ?? { ok: false, code: 'stale' });
    } catch { return { ok: false, code: 'invalid_input' }; }
  });
  return () => { for (const channel of Object.keys(handlers)) options.remove(channel); };
}
