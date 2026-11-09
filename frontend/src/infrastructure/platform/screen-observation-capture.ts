import { desktopCapturer, powerMonitor, screen } from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import type { IScreenObservationCapture, PreparedScreenObservation, ScreenCaptureAuthorization, ScreenCaptureAvailability } from '../../application/ports/screen-observation.interface';
import { parseScreenRegion } from '../../shared/screen-observation-validation';
import { screenJpegDimensions } from './screen-image-validation';

/** Single Windows display only. Native topology/source identity never crosses IPC. */
export class ElectronScreenObservationCapture implements IScreenObservationCapture {
  private blocked = false;
  private disposed = false;
  private readonly revoke = () => { this.blocked = true; this.invalidate(); };
  private readonly resume = () => { this.blocked = false; this.invalidate(); };
  private readonly topologyChanged = () => this.invalidate();
  constructor(private readonly now: () => number, private readonly invalidate: () => void) {
    powerMonitor.on('lock-screen', this.revoke); powerMonitor.on('suspend', this.revoke); powerMonitor.on('user-did-resign-active', this.revoke);
    powerMonitor.on('unlock-screen', this.resume); powerMonitor.on('resume', this.resume); powerMonitor.on('user-did-become-active', this.resume);
    screen.on('display-added', this.topologyChanged); screen.on('display-removed', this.topologyChanged); screen.on('display-metrics-changed', this.topologyChanged);
  }
  public availability(): ScreenCaptureAvailability {
    if (process.platform !== 'win32') return { status: 'unavailable', reason: 'unsupported_platform' };
    if (this.disposed || this.blocked) return { status: 'unavailable', reason: 'permission_denied' };
    if (screen.getAllDisplays().length !== 1) return { status: 'unavailable', reason: 'multiple_displays' };
    try { if (powerMonitor.getSystemIdleState(60) === 'locked') return { status: 'unavailable', reason: 'permission_denied' }; }
    catch { return { status: 'unavailable', reason: 'source_unavailable' }; }
    return { status: 'available' };
  }
  public selectionBounds(): Electron.Rectangle | null {
    if (this.availability().status !== 'available') return null;
    return { ...screen.getAllDisplays()[0]!.bounds };
  }
  private topology(): string { return JSON.stringify(screen.getAllDisplays().map(d => ({ id: d.id, bounds: d.bounds, scale: d.scaleFactor, rotation: d.rotation, size: d.size }))); }
  public async capture(auth: ScreenCaptureAuthorization, signal: AbortSignal): Promise<PreparedScreenObservation> {
    const region = parseScreenRegion(auth.region);
    if (auth.scope !== 'one_full_single_screen_frame_for_crop') throw new Error('Capture unavailable');
    const before = this.topology(), display = screen.getAllDisplays()[0];
    const valid = () => !signal.aborted && this.availability().status === 'available' && this.now() < auth.expiresAtMs && this.topology() === before;
    if (!display || !valid()) throw new Error('Capture unavailable');
    const factor = Math.min(1, 2048 / Math.max(display.bounds.width * display.scaleFactor, display.bounds.height * display.scaleFactor));
    const sources = await desktopCapturer.getSources({ types: ['screen'], fetchWindowIcons: false, thumbnailSize: { width: Math.max(1, Math.floor(display.bounds.width * display.scaleFactor * factor)), height: Math.max(1, Math.floor(display.bounds.height * display.scaleFactor * factor)) } });
    if (!valid() || sources.length !== 1 || sources[0]!.display_id !== String(display.id)) throw new Error('Capture unavailable');
    const source = sources[0]!.thumbnail;
    if (source.isEmpty()) throw new Error('Capture unavailable');
    const size = source.getSize();
    if (!Number.isInteger(size.width) || !Number.isInteger(size.height) || size.width < 1 || size.height < 1 || size.width > 4096 || size.height > 4096 || size.width * size.height > 16777216
      || Math.abs(size.width - size.height * display.bounds.width / display.bounds.height) > 1) throw new Error('Capture unavailable');
    const x = Math.floor(region.left * size.width), y = Math.floor(region.top * size.height);
    const width = Math.ceil((region.left + region.width) * size.width) - x, height = Math.ceil((region.top + region.height) * size.height) - y;
    if (width < 32 || height < 32 || x + width > size.width || y + height > size.height) throw new Error('Capture unavailable');
    let crop = source.crop({ x, y, width, height });
    if (Math.max(width, height) > 1024) {
      const scale = 1024 / Math.max(width, height);
      crop = crop.resize({ width: Math.floor(width * scale), height: Math.floor(height * scale), quality: 'good' });
    }
    const actual = crop.getSize();
    const jpeg = crop.toJPEG(70), dimensions = screenJpegDimensions(jpeg);
    if (dimensions.width !== actual.width || dimensions.height !== actual.height || !valid()) throw new Error('Capture unavailable');
    const preparedAtMs = this.now();
    return { context: auth.context, previewId: randomUUID(), digest: createHash('sha256').update(jpeg).digest('hex'), preparedAtMs, expiresAtMs: preparedAtMs + 30000,
      image: { mimeType: 'image/jpeg', ...dimensions, dataBase64: jpeg.toString('base64') } };
  }
  public dispose(): void {
    if (this.disposed) return; this.disposed = true;
    powerMonitor.removeListener('lock-screen', this.revoke); powerMonitor.removeListener('suspend', this.revoke); powerMonitor.removeListener('user-did-resign-active', this.revoke);
    powerMonitor.removeListener('unlock-screen', this.resume); powerMonitor.removeListener('resume', this.resume); powerMonitor.removeListener('user-did-become-active', this.resume);
    screen.removeListener('display-added', this.topologyChanged); screen.removeListener('display-removed', this.topologyChanged); screen.removeListener('display-metrics-changed', this.topologyChanged);
  }
}
