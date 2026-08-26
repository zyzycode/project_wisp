import { contextBridge, ipcRenderer } from 'electron';
import type {
  WispApiBridge,
  PingResponseDTO,
  SystemInfoDTO,
  IgnoreMouseEventsDTO,
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
  closeApp: (): Promise<void> => {
    return ipcRenderer.invoke('wisp:close-app');
  },
};

contextBridge.exposeInMainWorld('wispAPI', api);
