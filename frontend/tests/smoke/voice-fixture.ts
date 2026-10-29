import { ipcMain, type WebContents } from 'electron';
import { VoiceInputService } from '../../src/application/services/voice-input-service';
import { installVoicePermissions, registerVoiceInputIpc } from '../../src/main/voice-input-ipc';
import type { VoiceCaptureContextDTO } from '../../src/shared/ipc-contracts';

/** Test bundle only: actual service, validation and permissions; synthetic model/inference. */
export function installVoiceSmoke(sender: WebContents, context: VoiceCaptureContextDTO) {
  let transcriptions = 0;
  let samples = 0;
  const service = new VoiceInputService({
    adapter: {
      getStatus: () => ({ state: 'ready', downloadedBytes: 43_613_734, totalBytes: 43_613_734 }),
      prepare: async () => ({ ok: true, value: undefined }),
      transcribe: async audio => {
        transcriptions++; samples = audio.samples.length;
        return { ok: true, value: 'Проверка голосового ввода' };
      },
      dispose: async () => undefined,
    },
    context: () => context,
    onDisabled: () => { if (!sender.isDestroyed()) sender.send('wisp:voice-disabled', null); },
    createId: () => 'smoke-capture',
    schedule: (callback, delay) => { const timer = setTimeout(callback, delay); return () => clearTimeout(timer); },
  });
  const trustedUrl = (url: string) => new URL(url).origin === new URL(sender.getURL()).origin;
  for (const action of ['status', 'prepare', 'enable', 'disable', 'begin', 'transcribe', 'cancel']) ipcMain.removeHandler(`wisp:voice-${action}`);
  const unregister = registerVoiceInputIpc({ service, trustedUrl, getSender: () => sender,
    register: (channel, handler) => ipcMain.handle(channel, handler), remove: channel => ipcMain.removeHandler(channel) });
  installVoicePermissions(sender, service, trustedUrl);
  return { getStats: () => ({ transcriptions, samples, leased: service.hasCaptureLease() }),
    dispose: async () => { unregister(); await service.dispose(); } };
}
