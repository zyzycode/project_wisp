import type { ExternalWindowSurface, SurfaceBoundsDto } from '../../domain/behavior/surface-kinematics';

export interface BridgeWindow {
  readonly token: string;
  readonly x: number; readonly y: number; readonly width: number; readonly height: number;
  readonly top: boolean; readonly left: boolean; readonly right: boolean;
}
export interface SurfaceDisplay {
  readonly physicalBounds: SurfaceBoundsDto;
  readonly workArea: SurfaceBoundsDto;
}
const fields = ['token', 'x', 'y', 'width', 'height', 'top', 'left', 'right'];
export function parseBridgeResponse(value: unknown, requestId: number): readonly BridgeWindow[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid surface response');
  const message = value as Record<string, unknown>;
  if (Object.keys(message).sort().join(',') !== 'requestId,windows' || message.requestId !== requestId
      || !Array.isArray(message.windows) || message.windows.length > 512) throw new Error('Invalid surface response');
  const tokens = new Set<string>();
  return message.windows.map((raw: unknown) => {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid surface record');
    const r = raw as Record<string, unknown>;
    if (Object.keys(r).sort().join(',') !== [...fields].sort().join(',')
        || typeof r.token !== 'string' || !/^[0-9a-f]{32}$/.test(r.token) || tokens.has(r.token)
        || !['x', 'y', 'width', 'height'].every(k => typeof r[k] === 'number' && Number.isSafeInteger(r[k]) && Math.abs(r[k] as number) <= 10_000_000)
        || (r.width as number) <= 0 || (r.height as number) <= 0
        || !['top', 'left', 'right'].every(k => typeof r[k] === 'boolean')) throw new Error('Invalid surface record');
    tokens.add(r.token);
    return r as unknown as BridgeWindow;
  });
}
function contains(outer: SurfaceBoundsDto, inner: SurfaceBoundsDto): boolean {
  return inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
}
/** No division by scaleFactor; Electron converts the physical rectangle once. */
export function normalizeBridgeWindows(
  windows: readonly BridgeWindow[], displays: readonly SurfaceDisplay[],
  screenToDipRect: (bounds: SurfaceBoundsDto) => SurfaceBoundsDto, epoch: string,
): readonly ExternalWindowSurface[] {
  const surfaces: ExternalWindowSurface[] = [];
  for (const window of windows) {
    const physical = { x: window.x, y: window.y, width: window.width, height: window.height };
    const matching = displays.filter(display => contains(display.physicalBounds, physical));
    if (matching.length !== 1) continue; // Spanning or unmappable geometry is never clipped.
    const bounds = screenToDipRect(physical);
    if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0) throw new Error('Invalid DIP geometry');
    if (!contains(matching[0]!.workArea, bounds)) continue;
    const common = { bounds: Object.freeze({ ...bounds }), isValidSupport: true } as const;
    const id = `${epoch}:${window.token}`;
    if (window.top) surfaces.push(Object.freeze({ ...common, id: `${id}:top`, kind: 'window_top', supportY: bounds.y }));
    for (const side of ['left', 'right'] as const) {
      if (window[side]) surfaces.push(Object.freeze({ ...common, id: `${id}:${side}`, kind: 'window_side', side }));
    }
  }
  return Object.freeze(surfaces);
}
