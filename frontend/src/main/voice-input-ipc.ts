import type { IpcMainInvokeEvent, WebContents } from 'electron';
import type { VoiceInputService } from '../application/services/voice-input-service';
import { parseVoiceCancel, parseVoiceContext, parseVoiceTranscribe } from '../shared/voice-input-validation';
interface Options {
  readonly register: (channel: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>) => void;
  readonly remove: (channel: string) => void;
  readonly getSender: () => WebContents | null;
  readonly trustedUrl: (url: string) => boolean;
  readonly service: VoiceInputService;
}
export function registerVoiceInputIpc(options: Options): () => void {
  const channels = ['status', 'prepare', 'enable', 'startup', 'disable', 'begin', 'transcribe', 'cancel'] as const;
  for (const action of channels) options.register(`wisp:voice-${action}`, async (event, ...args) => {
    const sender = options.getSender();
    if (!sender || event.sender !== sender || event.senderFrame !== sender.mainFrame || !options.trustedUrl(event.senderFrame.url)) return { ok: false, code: 'invalid_request' };
    try {
      if (args.length !== (action === 'status' || action === 'prepare' || action === 'disable' ? 0 : 1)) return { ok: false, code: 'invalid_request' };
      switch (action) {
        case 'status': return options.service.readStatus();
        case 'prepare': return await options.service.prepare();
        case 'enable': return options.service.enable(parseVoiceContext(args[0]));
        case 'startup': return options.service.enableAtStartup(parseVoiceContext(args[0]));
        case 'disable': return options.service.disable();
        case 'begin': return options.service.begin(parseVoiceContext(args[0]));
        case 'transcribe': return await options.service.transcribe(parseVoiceTranscribe(args[0]));
        case 'cancel': return options.service.cancel(parseVoiceCancel(args[0]).requestId);
      }
    } catch { return { ok: false, code: 'invalid_request' }; }
  });
  return () => { for (const action of channels) options.remove(`wisp:voice-${action}`); };
}
export function installVoicePermissions(sender: WebContents, service: Pick<VoiceInputService, 'hasCaptureLease'>, trustedUrl: (url: string) => boolean, hasOutputLease: () => boolean = () => false): void {
  const allowed = (webContents: WebContents | null, permission: string, url: string, mainFrame: boolean, audio: boolean) =>
    webContents === sender && !sender.isDestroyed() && mainFrame && trustedUrl(url) && trustedUrl(sender.mainFrame.url) &&
    (permission === 'speaker-selection' ? hasOutputLease() : permission === 'media' && audio && service.hasCaptureLease());
  sender.session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(allowed(webContents, permission, details.requestingUrl, details.isMainFrame, 'mediaTypes' in details && details.mediaTypes?.length === 1 && details.mediaTypes[0] === 'audio'));
  });
  sender.session.setPermissionCheckHandler((webContents, permission, _origin, details) =>
    allowed(webContents, permission, details.requestingUrl ?? '', details.isMainFrame, details.mediaType === 'audio'));
}
