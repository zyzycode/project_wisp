import type { ObservationRuntime } from '../application/services/observation-runtime';
import type { ObservationApplication } from '../application/ports/active-application-observation.port';
import { parseObservationCommand, parseObservationSettings } from '../shared/observation-ipc-validation';
interface Options {
  readonly register: (channel: string, handler: (event: { readonly sender: object }, ...args: unknown[]) => Promise<unknown>) => void;
  readonly remove: (channel: string) => void; readonly getSender: () => object | null; readonly getStream: () => string | null;
  readonly getRuntime: () => ObservationRuntime | null; readonly pick: () => Promise<string | null>;
  readonly registerExecutable: (path: string) => ObservationApplication;
  readonly forgetExecutable: (key: string) => void; readonly clearExecutables: () => void;
}
export function registerObservationIpc(options: Options): () => void {
  let pickerOpen = false;
  options.register('wisp:observation-command', async (event, ...args) => {
    if (!options.getSender() || event.sender !== options.getSender() || args.length !== 1) throw new TypeError('Untrusted observation command');
    const command = parseObservationCommand(args[0]), runtime = options.getRuntime();
    if (!runtime || command.streamId !== options.getStream()) throw new TypeError('Stale observation command');
    if (command.type !== 'get' && command.generation !== runtime.getSettings().generation) throw new TypeError('Stale observation policy');
    if (command.type === 'pick') {
      if (pickerOpen) throw new TypeError('Observation picker busy');
      pickerOpen = true;
      try {
        const path = await options.pick();
        if (command.streamId !== options.getStream() || event.sender !== options.getSender() || command.generation !== runtime.getSettings().generation) throw new TypeError('Stale observation picker');
        if (path) runtime.addApplication(options.registerExecutable(path));
      } finally { pickerOpen = false; }
    } else if (command.type === 'remove') { runtime.removeApplication(command.appKey); options.forgetExecutable(command.appKey); }
    else if (command.type === 'exclude') runtime.exclude(command.appKey, command.excluded);
    else if (command.type === 'clear') { runtime.clear(); options.clearExecutables(); }
    else if (command.type === 'preview-open') runtime.preview(true);
    else if (command.type === 'preview-close') runtime.preview(false);
    else if (command.type !== 'get') runtime[command.type]();
    return parseObservationSettings(runtime.getSettings());
  });
  return () => options.remove('wisp:observation-command');
}
