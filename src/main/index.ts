import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import type {
  PingResponseDTO,
  SystemInfoDTO,
  IgnoreMouseEventsDTO,
  PetPositionDTO,
  ScreenBoundsDTO,
  InteractiveBoundsDTO,
} from '../shared/ipc-contracts';
import { createPlatformAdapter } from '../infrastructure/platform/platform-adapter.factory';
import { PetPositionService } from '../application/services/pet-position.service';

process.env.APP_ROOT = path.join(__dirname, '../..');

export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron');
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist');

process.env.VITE_PUBLIC = process.env.VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST;

export const WINDOW_WIDTH = 280;
export const WINDOW_HEIGHT = 320;

let mainWindow: BrowserWindow | null = null;
const platformAdapter = createPlatformAdapter();
let positionService: PetPositionService | null = null;

function resolvePreloadPath(): string {
  const jsPath = path.join(__dirname, '../preload/index.js');
  if (fs.existsSync(jsPath)) {
    return jsPath;
  }
  const mjsPath = path.join(__dirname, '../preload/index.mjs');
  if (fs.existsSync(mjsPath)) {
    return mjsPath;
  }
  return jsPath;
}

function calculateInitialPosition(): { x: number; y: number } {
  const workArea = platformAdapter.getDisplayWorkArea();
  const initialX = Math.round(
    workArea.x + Math.max(20, workArea.width - WINDOW_WIDTH - 60)
  );
  const initialY = Math.round(
    workArea.y + Math.max(20, workArea.height - WINDOW_HEIGHT - 60)
  );
  return { x: initialX, y: initialY };
}

function initializeServices(): void {
  const initial = calculateInitialPosition();
  positionService = new PetPositionService(initial);
  positionService.setPetSize({ width: WINDOW_WIDTH, height: WINDOW_HEIGHT });
}

function registerIpcHandlers(): void {
  ipcMain.handle('wisp:ping', async (_event, message: unknown): Promise<PingResponseDTO> => {
    const text = typeof message === 'string' ? message : '';
    return {
      reply: `Pong: ${text}`,
      timestamp: Date.now(),
    };
  });

  ipcMain.handle('wisp:get-system-info', async (): Promise<SystemInfoDTO> => {
    return {
      platform: platformAdapter.getPlatformName(),
      sessionType: platformAdapter.getDisplaySessionType(),
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron || 'unknown',
      chromeVersion: process.versions.chrome || 'unknown',
      nodeVersion: process.versions.node || 'unknown',
    };
  });

  ipcMain.handle(
    'wisp:set-ignore-mouse-events',
    async (_event, payload: IgnoreMouseEventsDTO): Promise<void> => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        const ignore = Boolean(payload?.ignore);
        const forward = payload?.forward ?? true;
        platformAdapter.setIgnoreMouseEvents(mainWindow, ignore, forward);
      }
    }
  );

  ipcMain.handle(
    'wisp:set-interactive-bounds',
    async (_event, _bounds: InteractiveBoundsDTO): Promise<void> => {
      // No longer required with Compact Window Pattern
    }
  );

  ipcMain.handle(
    'wisp:set-drag-state',
    async (_event, _isDragging: boolean): Promise<void> => {
      // Managed directly by native window positioning
    }
  );

  ipcMain.handle('wisp:get-position', async (): Promise<PetPositionDTO> => {
    return positionService ? positionService.getPosition() : calculateInitialPosition();
  });

  ipcMain.handle(
    'wisp:update-position',
    async (_event, targetPos: PetPositionDTO): Promise<PetPositionDTO> => {
      const currentPos = positionService
        ? positionService.getPosition()
        : calculateInitialPosition();

      const validX =
        typeof targetPos?.x === 'number' && Number.isFinite(targetPos.x)
          ? targetPos.x
          : currentPos.x;
      const validY =
        typeof targetPos?.y === 'number' && Number.isFinite(targetPos.y)
          ? targetPos.y
          : currentPos.y;

      const safePos: PetPositionDTO = { x: validX, y: validY };
      const bounds = platformAdapter.getDisplayWorkArea(safePos);
      const updated = positionService
        ? positionService.updatePosition(safePos, bounds)
        : safePos;

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setPosition(Math.round(updated.x), Math.round(updated.y));
      }

      return updated;
    }
  );

  ipcMain.handle('wisp:get-screen-bounds', async (): Promise<ScreenBoundsDTO> => {
    return platformAdapter.getDisplayWorkArea();
  });

  ipcMain.handle('wisp:close-app', async (): Promise<void> => {
    app.quit();
  });
}

function createWindow(): void {
  const preloadPath = resolvePreloadPath();
  const initialPos = calculateInitialPosition();

  mainWindow = new BrowserWindow({
    x: initialPos.x,
    y: initialPos.y,
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    show: true,
    transparent: true,
    frame: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    minimizable: false,
    resizable: false,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  // Apply platform-specific overlay configuration
  platformAdapter.configureOverlayWindow(mainWindow);

  // Prevent desktop minimization from hiding overlay
  mainWindow.on('minimize', () => {
    mainWindow?.restore();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    if (
      !process.env.VITE_DEV_SERVER_URL &&
      !navigationUrl.startsWith('file://')
    ) {
      event.preventDefault();
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(path.join(RENDERER_DIST, 'index.html'));
  }
}

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    initializeServices();
    registerIpcHandlers();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  app.on('window-all-closed', () => {
    if (platformAdapter.getPlatformName() !== 'darwin') {
      app.quit();
    }
  });
}
