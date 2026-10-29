import type { IpcMainInvokeEvent, WebContents } from 'electron';
import type { VoiceOutputService } from '../application/services/voice-output-service';
import { parsePlaybackAck, parseReplyIdentity, parseVoiceEnabled } from '../shared/voice-output-validation';
interface Options {
  readonly register: (channel: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>) => void;
  readonly remove: (channel: string) => void;
  readonly getSender: () => WebContents | null;
  readonly trustedUrl: (url: string) => boolean;
  readonly service: VoiceOutputService;
}
export function registerVoiceOutputIpc(options: Options): () => void {
  const actions = ['status', 'configure', 'speak', 'stop', 'acknowledge'] as const;
  for (const action of actions) options.register(`wisp:voice-output-${action}`, async (event, ...args) => {
    const sender = options.getSender();
    if (!sender || event.sender !== sender || event.senderFrame !== sender.mainFrame || !options.trustedUrl(event.senderFrame.url)) return { ok: false, code: 'invalid_request' };
    try {
      if (args.length !== (action === 'status' || action === 'stop' ? 0 : 1)) return { ok: false, code: 'invalid_request' };
      switch (action) {
        case 'status': return options.service.status();
        case 'configure': return options.service.configure(parseVoiceEnabled(args[0]).enabled);
        case 'speak': return await options.service.speak(parseReplyIdentity(args[0]));
        case 'stop': return options.service.stop();
        case 'acknowledge': return options.service.acknowledge(parsePlaybackAck(args[0]).playbackId);
      }
    } catch { return { ok: false, code: 'invalid_request' }; }
  });
  return () => { for (const action of actions) options.remove(`wisp:voice-output-${action}`); };
}
