import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import type { PingResponseDTO, SystemInfoDTO } from '../shared/ipc-contracts';

// In Vite development, process.env.VITE_DEV_SERVER_URL is provided by vite-plugin-electron
process.env.APP_ROOT = path.join(__dirname, '../..');

export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron');
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist');

process.env.VITE_PUBLIC = process.env.VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST;

let mainWindow: BrowserWindow | null = null;

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

function registerIpcHandlers(): void {
  ipcMain.handle('wisp:ping', async (_event, message: unknown): Promise<PingResponseDTO> => {
    const text = typeof message === 'string' ? message : '';
    return {
      reply: `Pong: ${text}`,
      timestamp: Date.now(),
    };
  });

  ipcMain.handle('wisp:get-system-info', async (): Promise<SystemInfoDTO> => {
    const platform = (
      process.platform === 'win32'
        ? 'win32'
        : process.platform === 'darwin'
          ? 'darwin'
          : 'linux'
    ) as 'linux' | 'win32' | 'darwin';

    return {
      platform,
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron || 'unknown',
      chromeVersion: process.versions.chrome || 'unknown',
      nodeVersion: process.versions.node || 'unknown',
    };
  });
}

function createWindow(): void {
  const preloadPath = resolvePreloadPath();

  mainWindow = new BrowserWindow({
    width: 900,
    height: 600,
    minWidth: 400,
    minHeight: 300,
    title: 'Project Wisp',
    show: false,
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

  // Open external links in default browser securely
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Block in-app navigation outside local app
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

// Single instance lock
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
    registerIpcHandlers();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
