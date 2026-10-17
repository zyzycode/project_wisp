import type { ISummaryRuntime } from '../application/ports/summary';
import { parseSummaryCommand, parseSummaryConfirm, parseSummaryDeleteResult, parseSummaryPreviewResult, parseSummaryTextResult } from '../shared/summary-ipc-validation';
interface Options {
  readonly register: (channel: string, handler: (event: { readonly sender: object }, ...args: unknown[]) => Promise<unknown>) => void;
  readonly remove: (channel: string) => void;
  readonly getSender: () => object | null;
  readonly getStream: () => string | null;
  readonly getRuntime: () => ISummaryRuntime | null;
}
export function registerSummaryIpc(options: Options): () => void {
  const operations = ['preview', 'confirm', 'delete'] as const;
  for (const operation of operations) options.register(`wisp:summary-${operation}`, async (event, ...args) => {
    if (options.getSender() === null || event.sender !== options.getSender()) throw new TypeError('Untrusted summary sender');
    if (args.length !== 1) throw new TypeError('Invalid summary arguments');
    const command = operation === 'confirm' ? parseSummaryConfirm(args[0]) : parseSummaryCommand(args[0]);
    if (command.streamId !== options.getStream()) return { ok: false, code: 'stale' };
    const runtime = options.getRuntime();
    if (!runtime) return { ok: false, code: 'unavailable' };
    if (operation === 'preview') return parseSummaryPreviewResult(await runtime.preview());
    if (operation === 'confirm') { const confirm = parseSummaryConfirm(command); return parseSummaryTextResult(await runtime.confirm(confirm.commandId, confirm.previewId)); }
    const result = await runtime.deleteSummary();
    return parseSummaryDeleteResult(result.ok ? { ok: true, value: null } : result);
  });
  return () => { for (const operation of operations) options.remove(`wisp:summary-${operation}`); };
}
