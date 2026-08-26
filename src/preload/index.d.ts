import type { WispApiBridge } from '../shared/ipc-contracts';

declare global {
  interface Window {
    wispAPI: WispApiBridge;
  }
}

export {};
