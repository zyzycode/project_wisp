import type { RoutineHypothesisRuntime } from './routine-hypothesis-runtime';
import type { RoutineHypothesisBridge, RoutineHypothesisCommandDTO, RoutineHypothesisReadDTO, RoutineHypothesisReadResultDTO, RoutineHypothesisResultDTO, RoutineWindowDTO } from '../../shared/routine-hypothesis-contracts';
import { parseRoutineCommand, parseRoutineRead } from '../../shared/routine-hypothesis-validation';
/** One correlated command/read, bound to the current Renderer stream. No retry queue. */
export class RoutineHypothesisControls implements RoutineHypothesisBridge {
  private stream: string | null = null;
  private epoch = 0;
  private sequence = 0;
  private pending = false;
  private reading = false;
  private receipt: { readonly body: string; readonly result: RoutineHypothesisResultDTO } | undefined;
  constructor(private readonly options: {
    readonly runtime: () => RoutineHypothesisRuntime | null;
    readonly backendAvailable: () => boolean;
    readonly window: () => RoutineWindowDTO;
    readonly generation: () => number;
  }) {}
  replaceStream(stream: string | null): void { this.stream = stream; this.epoch++; this.sequence = 0; this.receipt = undefined; this.options.runtime()?.endSession(); }
  async read(input: RoutineHypothesisReadDTO): Promise<RoutineHypothesisReadResultDTO> {
    const c = parseRoutineRead(input), runtime = this.options.runtime(), epoch = this.epoch, generation = this.options.generation();
    if (!runtime || c.streamId !== this.stream) return { ok:false,code:'stale' };
    if (this.reading || this.pending) return { ok:false,code:'busy' };
    this.reading = true;
    try {
      const state = await runtime.preview();
      if (epoch !== this.epoch || generation !== this.options.generation()) return { ok:false,code:'stale' };
      const { counts, ...rest } = state;
      return { ok:true,state:{ ...rest, backendAvailable:this.options.backendAvailable(), counts:counts ? { eligibleDays:counts.eligibleDays, positiveDays:counts.positiveDays, recentPositiveDays:counts.recentPositiveDays, observedThroughDate:counts.observedThroughDate, qualifies:counts.qualifies } : null } };
    } catch { return { ok:false,code:'unavailable' }; }
    finally { this.reading = false; }
  }
  async command(input: RoutineHypothesisCommandDTO): Promise<RoutineHypothesisResultDTO> {
    const c = parseRoutineCommand(input), runtime = this.options.runtime(), epoch = this.epoch;
    const fail = (code: 'stale' | 'busy' | 'unavailable'): RoutineHypothesisResultDTO => ({ requestId:c.requestId,ok:false,code });
    if (!runtime || c.streamId !== this.stream) return fail('stale');
    const body = JSON.stringify(c);
    if (this.receipt?.result.requestId === c.requestId) return this.receipt.body === body ? this.receipt.result : fail('stale');
    if (this.pending) return fail('busy');
    if (c.sequence <= this.sequence || (c.kind === 'suppression' && c.windowStartHour !== this.options.window())) return fail('stale');
    this.sequence = c.sequence; this.pending = true;
    try {
      if (c.kind === 'sharing') runtime.setSharing(c.enabled);
      else { const result = await runtime.setSuppressed(c.windowStartHour,c.suppressed); if (!result.ok) return fail('unavailable'); }
      if (epoch !== this.epoch) return fail('stale');
      const result: RoutineHypothesisResultDTO = { requestId:c.requestId,ok:true };
      this.receipt = { body,result }; return result;
    } catch { return fail('unavailable'); }
    finally { this.pending = false; }
  }
}
