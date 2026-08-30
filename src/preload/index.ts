import { contextBridge, ipcRenderer } from 'electron';
import type {
  WispApiBridge,
  PingResponseDTO,
  SystemInfoDTO,
  IgnoreMouseEventsDTO,
  PetPositionDTO,
  ScreenBoundsDTO,
  EnvironmentSnapshotDTO,
  BeginPetDragDTO,
  BeginPetDragResultDTO,
  MovePetDragDTO,
  ReleasePetDragDTO,
  PetPresentationStateDTO,
  InteractiveBoundsDTO,
  DebugTelemetryDTO,
  CharacterInteractionDTO,
} from '../shared/ipc-contracts';
import { isDebugMode } from '../shared/debug-mode';

const api: WispApiBridge = {
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
  beginPetDrag: (payload: BeginPetDragDTO): Promise<BeginPetDragResultDTO> => {
    return ipcRenderer.invoke('pet:begin-drag', payload);
  },
  movePetDrag: (payload: MovePetDragDTO): Promise<void> => {
    return ipcRenderer.invoke('pet:move-drag', payload);
  },
  releasePetDrag: (payload: ReleasePetDragDTO): Promise<void> => {
    return ipcRenderer.invoke('pet:release-drag', payload);
  },
  onPetPresentationState: (listener: (state: PetPresentationStateDTO) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: PetPresentationStateDTO): void => listener(state);
    ipcRenderer.on('pet:presentation-state', handler);
    return (): void => {
      ipcRenderer.removeListener('pet:presentation-state', handler);
    };
  },
  interactWithCharacter: (interaction: CharacterInteractionDTO): Promise<void> => {
    return ipcRenderer.invoke('wisp:character-interact', interaction);
  },
  setAlwaysOnTop: (enabled: boolean): Promise<boolean> => {
    return ipcRenderer.invoke('wisp:set-always-on-top', enabled);
  },
  setInteractiveBounds: (bounds: InteractiveBoundsDTO): Promise<void> => {
    return ipcRenderer.invoke('wisp:set-interactive-bounds', bounds);
  },
  setDragState: (isDragging: boolean): Promise<void> => {
    return ipcRenderer.invoke('wisp:set-drag-state', isDragging);
  },
  setMenuExpanded: (expanded: boolean): Promise<PetPositionDTO> => {
    return ipcRenderer.invoke('wisp:set-menu-expanded', expanded);
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
