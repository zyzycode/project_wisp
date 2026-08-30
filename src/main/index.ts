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
  DebugTelemetryDTO,
  CharacterInteractionDTO,
  CharacterInteractionTypeDTO,
  EnvironmentSnapshotDTO,
} from '../shared/ipc-contracts';
import { createPlatformAdapter } from '../infrastructure/platform/platform-adapter.factory';
import { PlatformEnvironmentAdapter } from '../infrastructure/platform/platform-environment.adapter';
import { PetPositionService } from '../application/services/pet-position.service';
import { defaultCharacterStateService } from '../application/services/character-state.service';
import { defaultCharacterInteractionUseCase } from '../application/services/character-interaction.use-case';
import { AppLogger, LogBuffer } from '../infrastructure/logging';
import { isDebugMode } from '../shared/debug-mode';
import { performance } from 'node:perf_hooks';
import {
  DEFAULT_MOTION_CONSTRAINTS,
  MotionEngine,
  SurfaceKinematics,
  type MotionState,
  type SurfaceKinematicsState,
} from '../domain/behavior';
import type { EnvironmentSnapshot } from '../domain/behavior/surface-kinematics';
import { ShimejiMotionOrchestrator } from '../application/services/shimeji-motion-orchestrator';
import { ElectronPetPositionAdapter } from '../infrastructure/adapters/electron-pet-position-adapter';
import {
  toEnvironmentSnapshotDTO,
  toPetPresentationStateDTO,
} from './mappers/shimeji-ipc.mapper';
import {
  handleBeginPetDrag,
  handleMovePetDrag,
  handleReleasePetDrag,
} from './shimeji-ipc-handlers';
import { startShimejiMotionLoop } from './shimeji-motion-loop';

process.env.APP_ROOT = path.join(__dirname, '../..');

export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron');
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist');

process.env.VITE_PUBLIC = process.env.VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST;

export const COMPACT_WINDOW_WIDTH = 280;
export const COMPACT_WINDOW_HEIGHT = 320;
export const EXPANDED_WINDOW_WIDTH = 1140;
export const EXPANDED_WINDOW_HEIGHT = 620;

export const WINDOW_WIDTH = COMPACT_WINDOW_WIDTH;
export const WINDOW_HEIGHT = COMPACT_WINDOW_HEIGHT;

let mainWindow: BrowserWindow | null = null;
const platformAdapter = createPlatformAdapter();
const platformEnvironmentAdapter = new PlatformEnvironmentAdapter();
let positionService: PetPositionService | null = null;
let unsubscribeEnvironmentChanges: (() => void) | null = null;
let shimejiMotionOrchestrator: ShimejiMotionOrchestrator | null = null;
let stopShimejiMotionLoopHandle: (() => void) | null = null;
const debugLogBuffer = new LogBuffer();
const appLogger = new AppLogger({
  level: 'debug',
  buffer: debugLogBuffer,
  sink: () => publishDebugTelemetry(),
});

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
  appLogger.info('CharacterEngine', 'Main character telemetry initialized');
}

function getDebugTelemetry(): DebugTelemetryDTO {
  const snapshot = defaultCharacterStateService.getSnapshot();
  const state = defaultCharacterStateService.getState();
  return {
    character: {
      needs: { ...snapshot.needs },
      relationship: { ...snapshot.relationship },
      synthesizedTone: snapshot.synthesizedTone,
      lastUpdated: state.lastUpdated,
    },
    logs: appLogger.getBufferedEntries().map((entry) => ({
      id: entry.id,
      level: entry.level,
      context: entry.context,
      message: entry.message,
      createdAt: entry.createdAt,
    })),
  };
}

function publishDebugTelemetry(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('wisp:debug-telemetry', getDebugTelemetry());
  }
}

function publishEnvironmentSnapshot(snapshot: EnvironmentSnapshot): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('wisp:environment-changed', toEnvironmentSnapshotDTO(snapshot));
  }
}

function publishPetPresentationState(): void {
  if (mainWindow === null || mainWindow.isDestroyed() || shimejiMotionOrchestrator === null) return;
  const motion = shimejiMotionOrchestrator.getMotionState();
  const animationState = motion.phase === 'dragged' ? 'dragged' : motion.phase === 'airborne' ? 'fall' : 'idle';
  mainWindow.webContents.send(
    'pet:presentation-state',
    toPetPresentationStateDTO({
      revision: shimejiMotionOrchestrator.getPresentationRevision(),
      motion,
      animationState,
    })
  );
}

function stopShimejiMotionLoop(): void {
  stopShimejiMotionLoopHandle?.();
  stopShimejiMotionLoopHandle = null;
  shimejiMotionOrchestrator = null;
}

function initializeShimejiMotionLoop(initialWindowPosition: PetPositionDTO): void {
  stopShimejiMotionLoop();
  const environment = platformEnvironmentAdapter.getSnapshot();
  const pivotOffset = {
    x: DEFAULT_MOTION_CONSTRAINTS.collisionInsets.left,
    y: DEFAULT_MOTION_CONSTRAINTS.collisionInsets.top,
  };
  const initialMotion: MotionState = {
    phase: 'grounded',
    position: { x: initialWindowPosition.x + pivotOffset.x, y: initialWindowPosition.y + pivotOffset.y },
    velocityPxPerSec: { x: 0, y: 0 },
    activeBoundsId: environment.screenBounds.id,
    airborneElapsedSec: 0,
    peakGroundImpactSeverity: 0,
  };
  const initialSurface: SurfaceKinematicsState = {
    phase: 'grounded',
    updatedAtMs: performance.now(),
    locomotionVelocityPxPerSec: { x: 0, y: 0 },
  };
  shimejiMotionOrchestrator = new ShimejiMotionOrchestrator({
    initialMotion,
    initialSurface,
    motionEngine: new MotionEngine(),
    surfaceKinematics: new SurfaceKinematics(),
    environment: () => platformEnvironmentAdapter.getSnapshot(),
    positionPort: new ElectronPetPositionAdapter({ getWindow: () => mainWindow, pivotOffset }),
    now: () => performance.now(),
  });
  stopShimejiMotionLoopHandle = startShimejiMotionLoop({
    orchestrator: shimejiMotionOrchestrator,
    getWindow: () => mainWindow,
    publishPresentation: publishPetPresentationState,
    intervalMs: Math.round(DEFAULT_MOTION_CONSTRAINTS.fixedStepSec * 1000),
  });
}

const CHARACTER_INTERACTION_TYPES: readonly CharacterInteractionTypeDTO[] = [
  'click',
  'double_click',
  'right_click',
  'drag_end',
  'pet',
  'play',
  'feed',
];

function isCharacterInteractionDTO(value: unknown): value is CharacterInteractionDTO {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<CharacterInteractionDTO>;
  return (
    CHARACTER_INTERACTION_TYPES.includes(candidate.type as CharacterInteractionTypeDTO) &&
    (candidate.intensity === undefined ||
      (typeof candidate.intensity === 'number' && Number.isFinite(candidate.intensity)))
  );
}

function registerIpcHandlers(): void {
  ipcMain.handle('wisp:ping', async (_event, message: unknown): Promise<PingResponseDTO> => {
    const text = typeof message === 'string' ? message : '';
    return {
      reply: `pong: ${text}`,
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
      // Managed by dynamic window sizing
    }
  );

  ipcMain.handle(
    'wisp:set-drag-state',
    async (_event, _isDragging: boolean): Promise<void> => {
      // Managed directly by native window positioning
    }
  );

  ipcMain.handle(
    'wisp:set-menu-expanded',
    async (_event, expanded: boolean): Promise<PetPositionDTO> => {
      const width = expanded ? EXPANDED_WINDOW_WIDTH : COMPACT_WINDOW_WIDTH;
      const height = expanded ? EXPANDED_WINDOW_HEIGHT : COMPACT_WINDOW_HEIGHT;

      if (positionService) {
        positionService.setPetSize({ width, height });
        const currentPos = positionService.getPosition();
        const bounds = platformAdapter.getDisplayWorkArea(currentPos);
        const updated = positionService.updatePosition(currentPos, bounds);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.setResizable(true);
          mainWindow.setSize(width, height);
        }
        return updated;
      }
      return calculateInitialPosition();
    }
  );

  ipcMain.handle('wisp:get-position', async (): Promise<PetPositionDTO> => {
    return positionService ? positionService.getPosition() : calculateInitialPosition();
  });

  ipcMain.handle('wisp:get-screen-bounds', async (): Promise<ScreenBoundsDTO> => {
    return platformAdapter.getDisplayWorkArea();
  });

  ipcMain.handle('wisp:get-environment-snapshot', async (): Promise<EnvironmentSnapshotDTO> => {
    return toEnvironmentSnapshotDTO(platformEnvironmentAdapter.getSnapshot());
  });

  ipcMain.handle('pet:begin-drag', async (_event, payload: unknown) => {
    if (shimejiMotionOrchestrator === null) throw new Error('Shimeji motion is unavailable');
    return handleBeginPetDrag(shimejiMotionOrchestrator, payload);
  });

  ipcMain.handle('pet:move-drag', async (_event, payload: unknown): Promise<void> => {
    if (shimejiMotionOrchestrator === null) return;
    handleMovePetDrag(shimejiMotionOrchestrator, payload);
  });

  ipcMain.handle('pet:release-drag', async (_event, payload: unknown): Promise<void> => {
    if (shimejiMotionOrchestrator === null) return;
    handleReleasePetDrag(shimejiMotionOrchestrator, payload);
  });

  ipcMain.handle(
    'wisp:character-interact',
    async (_event, interaction: unknown): Promise<void> => {
      if (!isCharacterInteractionDTO(interaction)) {
        throw new TypeError('Invalid character interaction payload');
      }
      defaultCharacterInteractionUseCase.execute(interaction);
      publishDebugTelemetry();
    }
  );

  ipcMain.handle(
    'wisp:set-always-on-top',
    async (_event, enabled: unknown): Promise<boolean> => {
      if (typeof enabled !== 'boolean') {
        throw new TypeError('Invalid always-on-top value');
      }
      if (!mainWindow || mainWindow.isDestroyed()) return false;
      platformAdapter.setAlwaysOnTop(mainWindow, enabled);
      return mainWindow.isAlwaysOnTop();
    }
  );

  if (isDebugMode()) {
    ipcMain.handle('wisp:get-debug-telemetry', async (): Promise<DebugTelemetryDTO> => getDebugTelemetry());
    ipcMain.handle('wisp:clear-debug-telemetry-logs', async (): Promise<void> => {
      appLogger.clearBuffer();
      publishDebugTelemetry();
    });
  }

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
    width: COMPACT_WINDOW_WIDTH,
    height: COMPACT_WINDOW_HEIGHT,
    show: true,
    transparent: true,
    frame: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    minimizable: false,
    resizable: true,
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
  initializeShimejiMotionLoop(initialPos);

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

  mainWindow.on('closed', () => {
    stopShimejiMotionLoop();
    mainWindow = null;
  });
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
    initializeServices();
    registerIpcHandlers();
    createWindow();
    unsubscribeEnvironmentChanges = platformEnvironmentAdapter.onEnvironmentChanged(
      publishEnvironmentSnapshot
    );

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });
}

app.on('window-all-closed', () => {
  if (platformAdapter.getPlatformName() !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopShimejiMotionLoop();
  unsubscribeEnvironmentChanges?.();
  unsubscribeEnvironmentChanges = null;
});
