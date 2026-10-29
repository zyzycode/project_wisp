import { ipcMain, type WebContents } from 'electron';
import { VoiceInputService } from '../../src/application/services/voice-input-service';
import { installVoicePermissions, registerVoiceInputIpc } from '../../src/main/voice-input-ipc';
import type { VoiceCaptureContextDTO } from '../../src/shared/ipc-contracts';
import { VoiceOutputService } from '../../src/application/services/voice-output-service';
import { registerVoiceOutputIpc } from '../../src/main/voice-output-ipc';
import { parseBrainStateDTO } from '../../src/shared/brain-body-ipc-validation';
import { LocalSpeechSynthesizer } from '../../src/infrastructure/voice-output/local-speech-synthesizer';
import path from 'node:path';

export function createNativeSpeechProbe(resources: string, entry: string) { return new LocalSpeechSynthesizer(resources, entry); }

/** Exercises real output service, IPC, contextBridge and browser playback with synthetic PCM. */
export async function installVoiceOutputSmoke(sender: WebContents, initial: unknown, real = false, deviceId = '') {
  let syntheses = 0;
  let acknowledgements = 0;
  let failNext = false;
  let lastPhase = 'idle';
  let lastOutcome: string | null = null;
  const native = real ? new LocalSpeechSynthesizer(path.join(__dirname, '../..', '.cache'), path.join(__dirname, 'speech-worker.js')) : null;
  const service = new VoiceOutputService({
    synthesizer: { ready: async () => native ? native.ready() : true, synthesize: async (text, language, signal) => {
      syntheses++;
      if (failNext) { failNext = false; throw new Error('Synthetic synthesis failure'); }
      if (native) {
        const speech = await native.synthesize(text, language, signal);
        if (!speech.samples.some(sample => Math.abs(sample) > 0.01)) throw new Error('Silent native speech');
        return speech;
      }
      return { sampleRate: 24000, samples: new Float32Array(2400) };
    }, dispose: async () => { await native?.dispose(); } },
    createId: () => `smoke-output-${syntheses + 1}`, language: () => 'ru',
    blockInput: () => undefined, revokeInput: () => sender.send('wisp:voice-disabled', null),
    revokePlayback: () => sender.send('wisp:voice-output-revoked', null),
  });
  await service.initialize(); await service.selectDevice(deviceId); service.observe(parseBrainStateDTO(initial));
  installVoicePermissions(sender, { hasCaptureLease: () => false }, url => new URL(url).origin === new URL(sender.getURL()).origin, () => service.hasSelectedPlaybackLease());
  const send = sender.send.bind(sender);
  sender.send = (channel: string, ...args: unknown[]): void => {
    if (channel === 'wisp:brain-state') {
      let snapshot = parseBrainStateDTO(args[0]);
      // Fixed synthetic reply bounds the explicit real-model probe; both contexts see identical text.
      if (real && snapshot.dialogue.turn.phase === 'completed' && snapshot.dialogue.turn.outcome.kind === 'success') {
        snapshot = { ...snapshot, dialogue: { ...snapshot.dialogue, turn: { ...snapshot.dialogue.turn, replyText: 'Привет!' } } };
        args[0] = snapshot;
      }
      lastPhase = snapshot.dialogue.turn.phase;
      lastOutcome = snapshot.dialogue.turn.phase === 'completed' ? snapshot.dialogue.turn.outcome.kind : null;
      service.observe(snapshot);
    }
    send(channel, ...args);
  };
  for (const action of ['status', 'startup', 'read-device', 'select-device', 'test', 'configure', 'speak', 'stop', 'acknowledge']) ipcMain.removeHandler(`wisp:voice-output-${action}`);
  const unregister = registerVoiceOutputIpc({ service,
    trustedUrl: url => new URL(url).origin === new URL(sender.getURL()).origin, getSender: () => sender,
    register: (channel, handler) => ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      if (channel === 'wisp:voice-output-acknowledge') acknowledgements++;
      return handler(event, ...args);
    }), remove: channel => ipcMain.removeHandler(channel),
  });
  return { getStats: () => ({ syntheses, acknowledgements, lastPhase, lastOutcome, status: service.status() }), failNext: () => { failNext = true; },
    dispose: async () => { sender.send = send; unregister(); await service.dispose(); } };
}

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
  for (const action of ['status', 'prepare', 'enable', 'startup', 'disable', 'begin', 'transcribe', 'cancel']) ipcMain.removeHandler(`wisp:voice-${action}`);
  const unregister = registerVoiceInputIpc({ service, trustedUrl, getSender: () => sender,
    register: (channel, handler) => ipcMain.handle(channel, handler), remove: channel => ipcMain.removeHandler(channel) });
  installVoicePermissions(sender, service, trustedUrl);
  return { getStats: () => ({ transcriptions, samples, leased: service.hasCaptureLease() }),
    dispose: async () => { unregister(); await service.dispose(); } };
}
