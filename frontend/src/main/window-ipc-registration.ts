import type {
  DebugTelemetryDTO, EnvironmentSnapshotDTO, IgnoreMouseEventsDTO, PetPositionDTO,
  ScreenBoundsDTO, SystemInfoDTO,
} from '../shared/ipc-contracts';
import { exactRecord } from '../shared/validation-primitives';
import { isTrustedIpcSender } from './shimeji-ipc-handlers';

interface Options {
  readonly register: (channel: string, handler: (event: { readonly sender: object }, payload: unknown) => Promise<unknown>) => void;
  readonly remove: (channel: string) => void;
  readonly getSender: () => object | null;
  readonly now: () => number;
  readonly systemInfo: () => SystemInfoDTO;
  readonly ignoreMouse: (command: IgnoreMouseEventsDTO) => void;
  readonly getPosition: () => PetPositionDTO;
  readonly updatePosition: (target: PetPositionDTO) => PetPositionDTO;
  readonly screenBounds: () => ScreenBoundsDTO;
  readonly environment: () => EnvironmentSnapshotDTO;
  readonly alwaysOnTop: (enabled: boolean) => boolean;
  readonly debug?: { readonly read: () => DebugTelemetryDTO; readonly clear: () => void };
  readonly close: () => void;
}

/** Window commands share the same sender boundary as dialogue and autonomy. */
export function registerWindowIpc(options: Options): () => void {
  const channels: string[] = [];
  const register = (channel: string, handle: (payload: unknown) => unknown): void => {
    options.register(channel, async (event, payload) => {
      if (!isTrustedIpcSender(event.sender, options.getSender())) throw new TypeError('Untrusted window sender');
      return handle(payload);
    });
    channels.push(channel);
  };
  const read = (channel: string, handle: () => unknown): void => register(channel, () => handle());
  register('wisp:ping', payload => {
    if (typeof payload !== 'string') throw new TypeError('Invalid ping message');
    return { reply: `pong: ${payload}`, timestamp: options.now() };
  });
  read('wisp:get-system-info', options.systemInfo);
  register('wisp:set-ignore-mouse-events', payload => {
    const command = exactRecord(payload, ['ignore'], ['forward']);
    if (typeof command.ignore !== 'boolean' || (command.forward !== undefined && typeof command.forward !== 'boolean')) {
      throw new TypeError('Invalid mouse mode');
    }
    options.ignoreMouse({ ignore: command.ignore, forward: command.forward ?? true });
  });
  read('wisp:get-position', options.getPosition);
  register('wisp:update-position', payload => {
    const r = exactRecord(payload, ['x', 'y']);
    if (typeof r.x !== 'number' || !Number.isFinite(r.x) || typeof r.y !== 'number' || !Number.isFinite(r.y)) {
      throw new TypeError('Invalid window position');
    }
    return options.updatePosition({ x: r.x, y: r.y });
  });
  read('wisp:get-screen-bounds', options.screenBounds);
  read('wisp:get-environment-snapshot', options.environment);
  register('wisp:set-always-on-top', payload => {
    if (typeof payload !== 'boolean') throw new TypeError('Invalid always-on-top value');
    return options.alwaysOnTop(payload);
  });
  if (options.debug) {
    read('wisp:get-debug-telemetry', options.debug.read);
    read('wisp:clear-debug-telemetry-logs', options.debug.clear);
  }
  read('wisp:close-app', options.close);
  return () => channels.forEach(channel => options.remove(channel));
}
