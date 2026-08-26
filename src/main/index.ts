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

const WINDOW_WIDTH = 300;
const WINDOW_HEIGHT = 380;

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

function initializeServices(): void {
  const initialWorkArea = platformAdapter.getDisplayWorkArea();
  const initialX = Math.max(0, initialWorkArea.x + initialWorkArea.width - WINDOW_WIDTH - 20);
  const initialY = Math.max(0, initialWorkArea.y + initialWorkArea.height - WINDOW_HEIGHT - 20);
  positionService = new PetPositionService({ x: initialX, y: initialY });
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
      // In compact window architecture, the entire window is the interactive container
    }
  );

  ipcMain.handle(
    'wisp:set-drag-state',
    async (_event, _isDragging: boolean): Promise<void> => {
      // Managed directly by window drag coordinates
    }
  );

  ipcMain.handle('wisp:get-position', async (): Promise<PetPositionDTO> => {
    return positionService ? positionService.getPosition() : { x: 300, y: 300 };
  });

  ipcMain.handle(
    'wisp:update-position',
    async (_event, targetPos: PetPositionDTO): Promise<PetPositionDTO> => {
      const currentPos = positionService
        ? positionService.getPosition()
        : { x: 300, y: 300 };
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
  const initialPos = positionService ? positionService.getPosition() : { x: 300, y: 300 };

  mainWindow = new BrowserWindow({
    x: Math.round(initialPos.x),
    y: Math.round(initialPos.y),
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    transparent: true,
    frame: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    resizable: false,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  // Apply platform-specific overlay configuration
  platformAdapter.configureOverlayWindow(mainWindow);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
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

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
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
