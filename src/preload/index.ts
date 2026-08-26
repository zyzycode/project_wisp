import { contextBridge, ipcRenderer } from 'electron';
import type { WispApiBridge, PingResponseDTO, SystemInfoDTO } from '../shared/ipc-contracts';

const api: WispApiBridge = {
  ping: (message: string): Promise<PingResponseDTO> => {
    return ipcRenderer.invoke('wisp:ping', message);
  },
  getSystemInfo: (): Promise<SystemInfoDTO> => {
    return ipcRenderer.invoke('wisp:get-system-info');
  },
};

contextBridge.exposeInMainWorld('wispAPI', api);
