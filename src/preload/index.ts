import { contextBridge, ipcRenderer } from 'electron';
import type {
  WispApiBridge,
  PingResponseDTO,
  SystemInfoDTO,
  IgnoreMouseEventsDTO,
  PetPositionDTO,
  ScreenBoundsDTO,
  InteractiveBoundsDTO,
} from '../shared/ipc-contracts';

const api: WispApiBridge = {
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
  updatePosition: (pos: PetPositionDTO): Promise<PetPositionDTO> => {
    return ipcRenderer.invoke('wisp:update-position', pos);
  },
  getScreenBounds: (): Promise<ScreenBoundsDTO> => {
    return ipcRenderer.invoke('wisp:get-screen-bounds');
  },
  setInteractiveBounds: (bounds: InteractiveBoundsDTO): Promise<void> => {
    return ipcRenderer.invoke('wisp:set-interactive-bounds', bounds);
  },
  setDragState: (isDragging: boolean): Promise<void> => {
    return ipcRenderer.invoke('wisp:set-drag-state', isDragging);
  },
  closeApp: (): Promise<void> => {
    return ipcRenderer.invoke('wisp:close-app');
  },
};

contextBridge.exposeInMainWorld('wispAPI', api);
