import { app, BrowserWindow, ipcMain, shell, screen } from 'electron';
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

let mainWindow: BrowserWindow | null = null;
const platformAdapter = createPlatformAdapter();
let positionService: PetPositionService | null = null;

let cursorTrackerInterval: ReturnType<typeof setInterval> | null = null;
let isCurrentlyIgnoring = false;
let isDraggingState = false;
let interactiveBounds: InteractiveBoundsDTO = {
  x: 300,
  y: 300,
  width: 140,
  height: 160,
};

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
  const initialX = Math.round(
    Math.max(50, initialWorkArea.width - 250)
  );
  const initialY = Math.round(
    Math.max(50, initialWorkArea.height - 250)
  );
  positionService = new PetPositionService({ x: initialX, y: initialY });
  interactiveBounds = {
    x: initialX - 20,
    y: initialY - 20,
    width: 160,
    height: 180,
  };
}

function startCursorTracking(): void {
  if (cursorTrackerInterval) {
    clearInterval(cursorTrackerInterval);
  }

  cursorTrackerInterval = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    if (isDraggingState) {
      if (isCurrentlyIgnoring) {
        isCurrentlyIgnoring = false;
        platformAdapter.setIgnoreMouseEvents(mainWindow, false);
      }
      return;
    }

    const cursor = screen.getCursorScreenPoint();
    const workArea = platformAdapter.getDisplayWorkArea();
    
    // Relative coordinates within the overlay window
    const relX = cursor.x - workArea.x;
    const relY = cursor.y - workArea.y;

    const isInside =
      relX >= interactiveBounds.x &&
      relX <= interactiveBounds.x + interactiveBounds.width &&
      relY >= interactiveBounds.y &&
      relY <= interactiveBounds.y + interactiveBounds.height;

    if (isInside && isCurrentlyIgnoring) {
      isCurrentlyIgnoring = false;
      platformAdapter.setIgnoreMouseEvents(mainWindow, false);
    } else if (!isInside && !isCurrentlyIgnoring) {
      isCurrentlyIgnoring = true;
      platformAdapter.setIgnoreMouseEvents(mainWindow, true, true);
    }
  }, 25);
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
        isCurrentlyIgnoring = ignore;
        platformAdapter.setIgnoreMouseEvents(mainWindow, ignore, forward);
      }
    }
  );

  ipcMain.handle(
    'wisp:set-interactive-bounds',
    async (_event, bounds: InteractiveBoundsDTO): Promise<void> => {
      if (bounds && typeof bounds.x === 'number' && typeof bounds.y === 'number') {
        interactiveBounds = { ...bounds };
      }
    }
  );

  ipcMain.handle(
    'wisp:set-drag-state',
    async (_event, isDragging: boolean): Promise<void> => {
      isDraggingState = Boolean(isDragging);
      if (isDraggingState && mainWindow && !mainWindow.isDestroyed()) {
        isCurrentlyIgnoring = false;
        platformAdapter.setIgnoreMouseEvents(mainWindow, false);
      }
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

      interactiveBounds.x = updated.x - 20;
      interactiveBounds.y = updated.y - 20;

      return updated;
    }
  );

  ipcMain.handle('wisp:get-screen-bounds', async (): Promise<ScreenBoundsDTO> => {
    return platformAdapter.getDisplayWorkArea();
  });

  ipcMain.handle('wisp:close-app', async (): Promise<void> => {
    if (cursorTrackerInterval) {
      clearInterval(cursorTrackerInterval);
      cursorTrackerInterval = null;
    }
    app.quit();
  });
}

function createWindow(): void {
  const preloadPath = resolvePreloadPath();
  const workArea = platformAdapter.getDisplayWorkArea();

  mainWindow = new BrowserWindow({
    x: workArea.x,
    y: workArea.y,
    width: workArea.width,
    height: workArea.height,
    show: true,
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

  // Initial mouse passthrough state
  platformAdapter.setIgnoreMouseEvents(mainWindow, true, true);
  isCurrentlyIgnoring = true;

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

  if (process.env.VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(path.join(RENDERER_DIST, 'index.html'));
  }

  startCursorTracking();
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
    if (cursorTrackerInterval) {
      clearInterval(cursorTrackerInterval);
      cursorTrackerInterval = null;
    }
    if (platformAdapter.getPlatformName() !== 'darwin') {
      app.quit();
    }
  });
}
