import type { BrowserWindow } from 'electron';

/** Native window operations used by Main, outside the Application boundary. */
export interface IElectronWindowAdapter {
  configureOverlayWindow(window: BrowserWindow): void;
  setAlwaysOnTop(window: BrowserWindow, enabled: boolean): void;
  setIgnoreMouseEvents(window: BrowserWindow, ignore: boolean, forward?: boolean): void;
}
