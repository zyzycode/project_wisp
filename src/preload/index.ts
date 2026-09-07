import { parseQuietModeCommand, parseAutonomyMode } from '../shared/quiet-mode-validation';
import { contextBridge, ipcRenderer } from 'electron';
import type {
  WispApiBridge,
  PingResponseDTO,
  SystemInfoDTO,
  IgnoreMouseEventsDTO,
  PetPositionDTO,
  ScreenBoundsDTO,
  EnvironmentSnapshotDTO,
  BrainStateDTO,
  BodyEventDTO,
  DebugTelemetryDTO,
  SetAutonomyEnabledDTO,
  SleepWakeCommandDTO,
} from '../shared/ipc-contracts';
import {
  parseBodyEventDTO,
  parseBrainStateDTO,
} from '../shared/brain-body-ipc-validation';
import { isDebugMode } from '../shared/debug-mode';
import { parseDialogueCommand, parseDialogueReceipt } from '../shared/dialogue-ipc-validation';

const brainStateListeners = new Set<(state: BrainStateDTO) => void>();
let latestBrainState: BrainStateDTO | null = null;

const brainStateHandler = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
  let state: BrainStateDTO;
  try {
    state = parseBrainStateDTO(payload);
  } catch {
    // Invalid Main payloads never cross the typed Preload boundary.
    return;
  }
  latestBrainState = state;
  for (const listener of brainStateListeners) {
    try {
      listener(parseBrainStateDTO(state));
    } catch {
      // One Renderer listener cannot block delivery to other typed subscribers.
    }
  }
};

ipcRenderer.on('wisp:brain-state', brainStateHandler);

const api: WispApiBridge = {
  setQuietMode: async command => parseAutonomyMode(await ipcRenderer.invoke('wisp:set-quiet-mode', parseQuietModeCommand(command))),
  postDialogueCommand: async command => parseDialogueReceipt(await ipcRenderer.invoke('wisp:dialogue-command', parseDialogueCommand(command))),
  debugEnabled: isDebugMode(),
  ping: (message: string): Promise<PingResponseDTO> => {
    return ipcRenderer.invoke('wisp:ping', message);
  },
  getSystemInfo: (): Promise<SystemInfoDTO> => {
    return ipcRenderer.invoke('wisp:get-system-info');
  },
  setIgnoreMouseEvents: (payload: IgnoreMouseEventsDTO): Promise<void> => {
    return ipcRenderer.invoke('wisp:set-ignore-mouse-events', payload);
  },
  getPosition: (): Promise<PetPositionDTO> => {
    return ipcRenderer.invoke('wisp:get-position');
  },
  updatePosition: (targetPos: PetPositionDTO): Promise<PetPositionDTO> => {
    return ipcRenderer.invoke('wisp:update-position', targetPos);
  },
  setAutonomyEnabled: (payload: SetAutonomyEnabledDTO): Promise<void> => {
    return ipcRenderer.invoke('wisp:set-autonomy-enabled', payload);
  },
  requestSleepWake: (command: SleepWakeCommandDTO): Promise<void> => {
    return ipcRenderer.invoke('wisp:request-sleep-wake', command);
  },
  onBrainState: (listener: (state: BrainStateDTO) => void): (() => void) => {
    brainStateListeners.add(listener);
    if (latestBrainState !== null) listener(parseBrainStateDTO(latestBrainState));
    return (): void => {
      brainStateListeners.delete(listener);
    };
  },
  postBodyEvent: (event: BodyEventDTO): Promise<void> => {
    return ipcRenderer.invoke('wisp:body-event', parseBodyEventDTO(event));
  },
  getScreenBounds: (): Promise<ScreenBoundsDTO> => {
    return ipcRenderer.invoke('wisp:get-screen-bounds');
  },
  getEnvironmentSnapshot: (): Promise<EnvironmentSnapshotDTO> => {
    return ipcRenderer.invoke('wisp:get-environment-snapshot');
  },
  onEnvironmentChanged: (callback: (snapshot: EnvironmentSnapshotDTO) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: EnvironmentSnapshotDTO): void => callback(snapshot);
    ipcRenderer.on('wisp:environment-changed', handler);
    return (): void => {
      ipcRenderer.removeListener('wisp:environment-changed', handler);
    };
  },
  setAlwaysOnTop: (enabled: boolean): Promise<boolean> => {
    return ipcRenderer.invoke('wisp:set-always-on-top', enabled);
  },
  ...(isDebugMode() ? {
    getDebugTelemetry: (): Promise<DebugTelemetryDTO> => ipcRenderer.invoke('wisp:get-debug-telemetry'),
    clearDebugTelemetryLogs: (): Promise<void> => ipcRenderer.invoke('wisp:clear-debug-telemetry-logs'),
    onDebugTelemetry: (listener: (telemetry: DebugTelemetryDTO) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, telemetry: DebugTelemetryDTO): void => listener(telemetry);
      ipcRenderer.on('wisp:debug-telemetry', handler);
      return (): void => { ipcRenderer.removeListener('wisp:debug-telemetry', handler); };
    },
  } : {}),
  closeApp: (): Promise<void> => {
    return ipcRenderer.invoke('wisp:close-app');
  },
};

contextBridge.exposeInMainWorld('wispAPI', api);
