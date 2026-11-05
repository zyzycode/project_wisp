import type { IInitiativeControls } from '../application/ports/initiative-controls.interface';
import type { IWindowHelpControls } from '../application/ports/window-help.interface';
import { parseInitiativeConsent, parseInitiativeRead, parseWindowHelpDecline } from '../shared/initiative-ipc-validation';
import { parseInitiativeResult, parseWindowHelpResult } from '../shared/initiative-status-validation';
interface Options {
  readonly register: (channel: string, handler: (event: { readonly sender: object }, ...args: unknown[]) => Promise<unknown>) => void;
  readonly remove: (channel: string) => void;
  readonly getSender: () => object | null;
  readonly controls: IInitiativeControls;
  readonly help: () => IWindowHelpControls | undefined;
}
export function registerInitiativeIpc(options: Options): () => void {
  const handlers = {
    'wisp:initiative-read': async (value: unknown) => parseInitiativeResult(await options.controls.read(parseInitiativeRead(value))),
    'wisp:initiative-consent': async (value: unknown) => parseInitiativeResult(await options.controls.setConsent(parseInitiativeConsent(value))),
    'wisp:window-help-decline': async (value: unknown) => parseWindowHelpResult(await options.help()?.decline(parseWindowHelpDecline(value)) ?? { ok: false, code: 'stale' }),
  };
  for (const [channel, handler] of Object.entries(handlers)) options.register(channel, async (event, ...args) => {
    if (!options.getSender() || event.sender !== options.getSender()) throw new TypeError('Untrusted initiative sender');
    try { if (args.length !== 1) throw new TypeError('Invalid initiative input'); return await handler(args[0]); }
    catch { return { ok: false, code: 'invalid_input' }; }
  });
  return () => { for (const channel of Object.keys(handlers)) options.remove(channel); };
}
