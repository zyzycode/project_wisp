import type { ClearMemoryUseCase } from '../application/services/clear-memory.use-case';
import type { MemoryStatusDTO } from '../shared/ipc-contracts';
import { parseClearMemoryCommand, parseClearMemoryResult, parseMemoryStatus } from '../shared/memory-ipc-validation';
interface Options {
  readonly register: (channel: string, handler: (event: { readonly sender: object }, ...args: unknown[]) => Promise<unknown>) => void;
  readonly remove: (channel: string) => void;
  readonly getSender: () => object | null;
  readonly getStatus: () => MemoryStatusDTO;
  readonly clear: ClearMemoryUseCase;
}
export function registerMemoryIpc(options: Options): () => void {
  const trusted = (sender: object) => { if (options.getSender() === null || sender !== options.getSender()) throw new TypeError('Untrusted memory sender'); };
  options.register('wisp:get-memory-status', async (event, ...args) => { trusted(event.sender); if (args.length !== 0) throw new TypeError('Invalid memory status arguments'); return parseMemoryStatus(options.getStatus()); });
  options.register('wisp:clear-memory', async (event, ...args) => { trusted(event.sender); if (args.length !== 1) throw new TypeError('Invalid memory arguments'); return parseClearMemoryResult(await options.clear.execute(parseClearMemoryCommand(args[0]))); });
  return () => { options.remove('wisp:get-memory-status'); options.remove('wisp:clear-memory'); };
}
