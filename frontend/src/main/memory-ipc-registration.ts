import { parseInterestThreadCommand, parseInterestThreadRead, parseInterestThreadReadResult, parseInterestThreadMutationResult } from '../shared/interest-thread-validation';
import { parseMemoryCardCommand, parseMemoryCardListCommand, parseMemoryCardListResult, parseMemoryCardResult } from '../shared/memory-card-validation';
import type { ClearMemoryUseCase } from '../application/services/clear-memory.use-case';
import type { MemoryCardCommandDTO, MemoryCardResultDTO, MemoryCardListCommandDTO, MemoryCardListResultDTO, MemoryStatusDTO } from '../shared/ipc-contracts';
import { parseClearMemoryCommand, parseClearMemoryResult, parseMemoryStatus } from '../shared/memory-ipc-validation';
interface Options {
  readonly register: (channel: string, handler: (event: { readonly sender: object }, ...args: unknown[]) => Promise<unknown>) => void;
  readonly remove: (channel: string) => void;
  readonly getSender: () => object | null;
  readonly getStatus: () => MemoryStatusDTO;
  readonly clear: ClearMemoryUseCase;
  readonly interestThread?: import('../shared/ipc-contracts').InterestThreadApiBridge;
  readonly cards?: {
    mutate(command: MemoryCardCommandDTO): Promise<MemoryCardResultDTO>;
    list(command: MemoryCardListCommandDTO): Promise<MemoryCardListResultDTO>;
  };
}
export function registerMemoryIpc(options: Options): () => void {
  const trusted = (sender: object) => { if (options.getSender() === null || sender !== options.getSender()) throw new TypeError('Untrusted memory sender'); };
  options.register('wisp:get-memory-status', async (event, ...args) => { trusted(event.sender); if (args.length !== 0) throw new TypeError('Invalid memory status arguments'); return parseMemoryStatus(options.getStatus()); });
  options.register('wisp:clear-memory', async (event, ...args) => { trusted(event.sender); if (args.length !== 1) throw new TypeError('Invalid memory arguments'); return parseClearMemoryResult(await options.clear.execute(parseClearMemoryCommand(args[0]))); });
  if (options.interestThread) {
    options.register('wisp:read-interest-thread', async (event, ...args) => { trusted(event.sender); if (args.length !== 1) throw new TypeError('Invalid topic arguments'); return parseInterestThreadReadResult(await options.interestThread!.read(parseInterestThreadRead(args[0]))); });
    options.register('wisp:mutate-interest-thread', async (event, ...args) => { trusted(event.sender); if (args.length !== 1) throw new TypeError('Invalid topic arguments'); return parseInterestThreadMutationResult(await options.interestThread!.mutate(parseInterestThreadCommand(args[0]))); });
  }
  const cards = options.cards;
  if (cards) {
    options.register('wisp:mutate-memory-card', async (event, ...args) => {
      trusted(event.sender); if (args.length !== 1) throw new TypeError('Invalid memory card arguments');
      return parseMemoryCardResult(await cards.mutate(parseMemoryCardCommand(args[0])));
    });
    options.register('wisp:list-memory-cards', async (event, ...args) => {
      trusted(event.sender); if (args.length !== 1) throw new TypeError('Invalid memory list arguments');
      return parseMemoryCardListResult(await cards.list(parseMemoryCardListCommand(args[0])));
    });
  }
  return () => { if (options.interestThread) { options.remove('wisp:read-interest-thread'); options.remove('wisp:mutate-interest-thread'); } if (cards) { options.remove('wisp:mutate-memory-card'); options.remove('wisp:list-memory-cards'); } options.remove('wisp:get-memory-status'); options.remove('wisp:clear-memory'); };
}
