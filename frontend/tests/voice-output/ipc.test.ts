import { expect, it, vi } from 'vitest';
import { registerVoiceOutputIpc } from '../../src/main/voice-output-ipc';
import type { IpcMainInvokeEvent, WebContents } from 'electron';
import { VoiceOutputService } from '../../src/application/services/voice-output-service';
it('rejects untrusted frames and extra text before dispatching a speech command', async () => {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>>();
  const service = new VoiceOutputService({ synthesizer: { ready: async () => true, synthesize: async () => ({ sampleRate: 24000, samples: new Float32Array([0.1]) }), dispose: async () => undefined }, createId: () => 'p', language: () => 'ru', blockInput: vi.fn(), revokeInput: vi.fn(), revokePlayback: vi.fn() });
  const speak = vi.spyOn(service, 'speak');
  const sender = { mainFrame: { url: 'https://app.invalid/' } } as WebContents;
  const event = { sender, senderFrame: sender.mainFrame } as IpcMainInvokeEvent;
  const unregister = registerVoiceOutputIpc({ register: (name, handler) => handlers.set(name, handler), remove: name => { handlers.delete(name); }, getSender: () => sender, trustedUrl: url => url === 'https://app.invalid/', service });
  const handler = handlers.get('wisp:voice-output-speak')!;
  const identity = { streamId: 's', conversationId: 'c', requestId: 'r' };
  expect(await handler({ ...event, senderFrame: { url: 'https://other.invalid/' } } as IpcMainInvokeEvent, identity)).toEqual({ ok: false, code: 'invalid_request' });
  expect(await handler(event, { ...identity, text: 'injected' })).toEqual({ ok: false, code: 'invalid_request' });
  expect(speak).not.toHaveBeenCalled(); unregister(); expect(handlers.size).toBe(0); await service.dispose();
});
