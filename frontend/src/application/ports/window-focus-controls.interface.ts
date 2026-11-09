import type { WindowFocusChooseCommandDTO, WindowFocusOpenCommandDTO, WindowFocusReceiptDTO,
  WindowFocusSelectorDTO } from './external-window-focus.port';
export interface WindowFocusStateDTO {
  readonly capability: 'available' | 'unavailable' | 'unsupported';
  readonly selector: WindowFocusSelectorDTO | null;
  readonly pending: boolean;
  readonly receipt: WindowFocusReceiptDTO | null;
}
export type WindowFocusControlResult = { readonly ok: true; readonly state: WindowFocusStateDTO }
  | { readonly ok: false; readonly code: 'invalid_input' | 'stale' | 'busy' };
/** Explicit local request only. A selection asks Main to show its own native confirmation. */
export interface IWindowFocusControls {
  read(command: WindowFocusOpenCommandDTO): Promise<WindowFocusControlResult>;
  open(command: WindowFocusOpenCommandDTO): Promise<WindowFocusControlResult>;
  choose(command: WindowFocusChooseCommandDTO): Promise<WindowFocusControlResult>;
  cancel(command: WindowFocusOpenCommandDTO): Promise<WindowFocusControlResult>;
}
