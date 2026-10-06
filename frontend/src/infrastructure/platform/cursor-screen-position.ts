import { screen } from 'electron';
import type { IPlatformAdapter } from '../../application/ports/platform-adapter.interface';

/** Electron already returns DIP; another DPI conversion would corrupt the target. */
export function readCursorScreenPosition(): ReturnType<IPlatformAdapter['getCursorScreenPosition']> {
  try {
    const point = screen.getCursorScreenPoint();
    return Number.isFinite(point.x) && Number.isFinite(point.y) ? { x: point.x, y: point.y } : null;
  } catch { return null; }
}
