import type { RoutineHypothesisBridge, RoutineHypothesisCommandDTO, RoutineHypothesisStateDTO, RoutineWindowDTO } from '../shared/routine-hypothesis-contracts';
import { parseRoutineReadResult, parseRoutineResult } from '../shared/routine-hypothesis-validation';
interface State { readonly value: RoutineHypothesisStateDTO | null; readonly busy: boolean; readonly message: string | null }
/** Presentation/correlation only; consent and suppression belong to Main. */
export class RoutineHypothesisClient {
  private stream: string | null = null;
  private epoch = 0;
  private sequence = 0;
  private state: State = { value:null,busy:false,message:null };
  private readonly listeners = new Set<() => void>();
  constructor(private readonly bridge: RoutineHypothesisBridge, private readonly uuid = () => crypto.randomUUID()) {}
  readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  readonly getState = () => this.state;
  private patch(state: Partial<State>): void { this.state = { ...this.state,...state }; this.listeners.forEach(listener => listener()); }
  acceptStream(stream: string | null): void {
    if (stream === this.stream) return;
    this.epoch++; this.sequence = 0; this.stream = stream; this.patch({ value:null,busy:false,message:null });
  }
  async read(): Promise<void> {
    if (!this.stream || this.state.busy) return;
    const streamId = this.stream, epoch = this.epoch;
    this.patch({ busy:true,message:null });
    try {
      const result = parseRoutineReadResult(await this.bridge.read({ streamId }));
      if (epoch !== this.epoch) return;
      this.patch(result.ok ? { value:result.state } : { value:null,message:'Не удалось проверить гипотезу. Обновите проверку.' });
    } catch { if (epoch === this.epoch) this.patch({ value:null,message:'Проверка не подтверждена. Обновите её перед изменением настроек.' }); }
    finally { if (epoch === this.epoch) this.patch({ busy:false }); }
  }
  async share(enabled: boolean): Promise<void> { await this.command({ kind:'sharing',enabled }); }
  async suppress(windowStartHour: RoutineWindowDTO, suppressed: boolean): Promise<void> { await this.command({ kind:'suppression',windowStartHour,suppressed }); }
  private async command(action: { readonly kind:'sharing'; readonly enabled:boolean } | { readonly kind:'suppression'; readonly windowStartHour:RoutineWindowDTO; readonly suppressed:boolean }): Promise<void> {
    if (!this.stream || this.state.busy) return;
    const epoch = this.epoch;
    const command: RoutineHypothesisCommandDTO = { ...action,streamId:this.stream,requestId:this.uuid(),sequence:++this.sequence };
    this.patch({ busy:true,message:null, ...(this.state.value && action.kind === 'sharing' && !action.enabled ? { value:{ ...this.state.value,sharing:false } } : {}) });
    let refresh = false;
    try {
      const result = parseRoutineResult(await this.bridge.command(command));
      if (epoch !== this.epoch) return;
      if (result.requestId !== command.requestId) throw new TypeError('Uncorrelated routine receipt');
      if (!result.ok) this.patch({ value:null,message:'Изменение не подтверждено. Обновите проверку; автоматического повтора нет.' });
      else refresh = true;
    } catch { if (epoch === this.epoch) this.patch({ value:null,message:'Изменение не подтверждено. Передача отозванного вывода остаётся заблокированной. Обновите проверку.' }); }
    finally { if (epoch === this.epoch) { this.patch({ busy:false }); if (refresh) await this.read(); } }
  }
}
const clients = new WeakMap<RoutineHypothesisBridge,RoutineHypothesisClient>();
export function getRoutineHypothesisClient(bridge: RoutineHypothesisBridge): RoutineHypothesisClient {
  let client = clients.get(bridge);
  if (!client) { client = new RoutineHypothesisClient(bridge); clients.set(bridge,client); }
  return client;
}
