import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { ElectronScreenObservationCapture } from '../../src/infrastructure/platform/screen-observation-capture';
const mocks = vi.hoisted(() => ({ displays: vi.fn(), getSources: vi.fn(), idle: vi.fn(), power: undefined as EventEmitter | undefined, screen: undefined as EventEmitter | undefined }));
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  mocks.power = new EventEmitter(); mocks.screen = new EventEmitter();
  return { powerMonitor: Object.assign(mocks.power, { getSystemIdleState: mocks.idle }), screen: Object.assign(mocks.screen, { getAllDisplays: mocks.displays }), desktopCapturer: { getSources: mocks.getSources } };
});
const corpus = JSON.parse(readFileSync(new URL('../../../docs/contracts/fixtures/desktop-backend-v1/screen-observation.json', import.meta.url), 'utf8'));
function jpeg(width: number, height: number) {
  const data = Buffer.from(corpus.requests.valid[0].value.image.dataBase64, 'base64');
  const offset = data.indexOf(Buffer.from([255, 192]));
  data.writeUInt16BE(height, offset + 5); data.writeUInt16BE(width, offset + 7); return data;
}
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
const display = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1.5, rotation: 0, size: { width: 1920, height: 1080 } };
function thumbnail(width = 1920, height = 1080) {
  const crop = { getSize: vi.fn(() => ({ width: 960, height: 540 })), toJPEG: vi.fn(() => jpeg(960, 540)), resize: vi.fn() };
  const source = { isEmpty: () => false, getSize: () => ({ width, height }), crop: vi.fn(() => crop) };
  return { source, crop };
}
const auth = { context: { streamId: 's', conversationId: 'c', requestId: 'r', generation: 0 }, confirmationId: 'confirm', scope: 'one_full_single_screen_frame_for_crop' as const, region: { left: .1, top: .1, width: .5, height: .5 }, expiresAtMs: 10000 };
beforeEach(() => { Object.defineProperty(process, 'platform', { value: 'win32' }); mocks.displays.mockReturnValue([display]); mocks.idle.mockReturnValue('active'); mocks.getSources.mockReset(); });
afterEach(() => { Object.defineProperty(process, 'platform', platform); mocks.power?.removeAllListeners(); mocks.screen?.removeAllListeners(); });
it('captures once after supplied explicit authorization; maps actual pixels exactly once and strips full source identity', async () => {
  const image = thumbnail(); mocks.getSources.mockResolvedValue([{ display_id: '1', name: 'private', thumbnail: image.source }]);
  const capture = new ElectronScreenObservationCapture(() => 100, vi.fn());
  const result = await capture.capture(auth, new AbortController().signal);
  expect(mocks.getSources).toHaveBeenCalledOnce(); expect(mocks.getSources.mock.calls[0]![0]).toMatchObject({ types: ['screen'], fetchWindowIcons: false, thumbnailSize: { width: 2048, height: 1152 } });
  expect(image.source.crop).toHaveBeenCalledWith({ x: 192, y: 108, width: 960, height: 540 }); expect(image.crop.toJPEG).toHaveBeenCalledWith(70);
  expect(result.image).toMatchObject({ width: 960, height: 540, mimeType: 'image/jpeg' }); expect(JSON.stringify(result)).not.toContain('private'); expect(result.digest).toMatch(/^[a-f0-9]{64}$/u); capture.dispose();
});
it.each(['platform', 'multiple', 'locked', 'expired', 'aborted'] as const)('never invokes getSources for %s', async reason => {
  if (reason === 'platform') Object.defineProperty(process, 'platform', { value: 'linux' });
  if (reason === 'multiple') mocks.displays.mockReturnValue([display, { ...display, id: 2 }]);
  if (reason === 'locked') mocks.idle.mockReturnValue('locked');
  const controller = new AbortController(); if (reason === 'aborted') controller.abort();
  const capture = new ElectronScreenObservationCapture(() => reason === 'expired' ? 11000 : 100, vi.fn());
  await expect(capture.capture(auth, controller.signal)).rejects.toThrow(); expect(mocks.getSources).not.toHaveBeenCalled(); capture.dispose();
});
it.each(['topology', 'cancel', 'lock'] as const)('late getSources after %s is discarded before crop', async reason => {
  let resolve!: (value: unknown) => void; mocks.getSources.mockReturnValue(new Promise(yes => { resolve = yes; }));
  const image = thumbnail(), controller = new AbortController(), revoke = vi.fn(() => controller.abort());
  const capture = new ElectronScreenObservationCapture(() => 100, revoke), pending = capture.capture(auth, controller.signal);
  if (reason === 'topology') { mocks.displays.mockReturnValue([{ ...display, scaleFactor: 2 }]); mocks.screen!.emit('display-metrics-changed'); }
  if (reason === 'cancel') controller.abort(); if (reason === 'lock') mocks.power!.emit('lock-screen');
  resolve([{ display_id: '1', thumbnail: image.source }]); await expect(pending).rejects.toThrow(); expect(image.source.crop).not.toHaveBeenCalled(); capture.dispose();
});
it.each(['identity', 'size', 'aspect', 'metadata'] as const)('rejects %s without retry or exposure', async reason => {
  const image = thumbnail(reason === 'size' ? 5000 : 1920, reason === 'aspect' ? 1000 : 1080);
  if (reason === 'metadata') image.crop.toJPEG.mockReturnValue(Buffer.from([255, 216, 255, 225, 0, 2, 255, 217]));
  mocks.getSources.mockResolvedValue([{ display_id: reason === 'identity' ? '2' : '1', thumbnail: image.source }]);
  const capture = new ElectronScreenObservationCapture(() => 100, vi.fn());
  await expect(capture.capture(auth, new AbortController().signal)).rejects.toThrow(); expect(mocks.getSources).toHaveBeenCalledOnce(); capture.dispose();
});
it('removes every lifecycle listener idempotently without restoring old consent', () => {
  const revoke = vi.fn(), capture = new ElectronScreenObservationCapture(() => 100, revoke);
  mocks.power!.emit('lock-screen'); expect(capture.availability().status).toBe('unavailable'); mocks.power!.emit('unlock-screen'); expect(revoke).toHaveBeenCalledTimes(2);
  capture.dispose(); capture.dispose(); expect(mocks.power!.eventNames()).toEqual([]); expect(mocks.screen!.eventNames()).toEqual([]); expect(capture.availability().status).toBe('unavailable');
});
