import { expect, it, vi } from 'vitest';
import type { Session, WebContents } from 'electron';
import { installVoicePermissions } from '../../src/main/voice-input-ipc';
import { VoiceInputService } from '../../src/application/services/voice-input-service';
it('allows only audio on trusted main frame during explicit capture lease', () => {
  let request!: NonNullable<Parameters<Session['setPermissionRequestHandler']>[0]>;
  let check!: NonNullable<Parameters<Session['setPermissionCheckHandler']>[0]>;
  const sender = {
    isDestroyed: () => false,
    mainFrame: { url: 'file:///app/index.html' },
    session: { setPermissionRequestHandler: (handler: typeof request) => { request = handler; }, setPermissionCheckHandler: (handler: typeof check) => { check = handler; } },
  } as WebContents;
  const service = new VoiceInputService({ context: () => ({ streamId: 's', conversationId: 'c' }), createId: () => 'r', schedule: () => () => undefined,
    adapter: { getStatus: () => ({ state: 'ready', downloadedBytes: 1, totalBytes: 1 }), prepare: async () => ({ ok: true, value: undefined }), transcribe: async () => ({ ok: true, value: '' }), dispose: async () => undefined } });
  installVoicePermissions(sender, service, url => url === 'file:///app/index.html');
  const callback = vi.fn();
  const details = { requestingUrl: 'file:///app/index.html', isMainFrame: true, mediaTypes: ['audio'] };
  request(sender, 'media', callback, details); expect(callback).toHaveBeenLastCalledWith(false);
  service.enable({ streamId: 's', conversationId: 'c' });
  request(sender, 'media', callback, details); expect(callback).toHaveBeenLastCalledWith(true);
  request(sender, 'media', callback, { ...details, mediaTypes: ['video'] }); expect(callback).toHaveBeenLastCalledWith(false);
  request(sender, 'media', callback, { ...details, isMainFrame: false }); expect(callback).toHaveBeenLastCalledWith(false);
  request(sender, 'media', callback, { ...details, requestingUrl: 'https://evil.test' }); expect(callback).toHaveBeenLastCalledWith(false);
  request({ ...sender } as WebContents, 'media', callback, details); expect(callback).toHaveBeenLastCalledWith(false);
  expect(check(sender, 'media', 'file://', { requestingUrl: details.requestingUrl, isMainFrame: true, mediaType: 'audio' })).toBe(true);
  expect(check(sender, 'media', 'file://', { requestingUrl: details.requestingUrl, isMainFrame: true, mediaType: 'unknown' })).toBe(false);
  service.disable(); request(sender, 'media', callback, details); expect(callback).toHaveBeenLastCalledWith(false);
});
