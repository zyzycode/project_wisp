import type { BeverageCapture, BeverageOffer, IBeverageDialogue } from '../ports/memory-beverage.interface';
import type { MemoryLifecycle } from './memory-lifecycle';
import type { MemoryOperationContext } from '../ports/memory-repository.interface';

/** Deliberately complete-utterance grammar; never a general preference classifier. */
export function recognizeBeverageCorrection(text: string): 'coffee' | 'tea' | null {
  const normalized = text.trim().normalize('NFC').toLowerCase().replace(/[.!?]$/u, '');
  const match = /^(?:(?:нет, )?(?:я )?предпочитаю (кофе|чай)|(?:no, )?i prefer (coffee|tea))$/u.exec(normalized);
  if (!match || normalized === 'предпочитаю кофе' || normalized === 'предпочитаю чай') return null;
  return match[1] === 'кофе' || match[2] === 'coffee' ? 'coffee' : 'tea';
}
export class BeverageDialogue implements IBeverageDialogue {
  private currentOffer: (BeverageOffer & { generation: number }) | null = null;
  constructor(private readonly options: {
    readonly runtime: () => Pick<MemoryLifecycle, 'readBeverage' | 'mutateBeverage' | 'context'> | null;
    readonly createId: () => string;
    readonly timestamp: () => string;
    readonly now: () => number;
    readonly isAdmissionCurrent: (token: object) => boolean;
  }) {}
  invalidateOffer(): void { this.currentOffer = null; }
  async admit(input: Parameters<IBeverageDialogue['admit']>[0], context: MemoryOperationContext): ReturnType<IBeverageDialogue['admit']> {
    const runtime = this.options.runtime();
    const value = input.replyToTopic ? null : recognizeBeverageCorrection(input.text);
    if (!runtime || value === null) return { ok: true, value: { generation: context.generation } };
    const read = await runtime.readBeverage();
    if (!this.options.isAdmissionCurrent(input.admissionToken) || this.options.now() >= input.deadlineMs || runtime.context()?.generation !== context.generation) return { ok: false, code: 'stale' };
    if (!read.ok) return read;
    const item = read.value;
    if (!item || (item.status === 'active' && item.validity === 'confirmed' && item.value === value)) return { ok: true, value: { generation: context.generation } };
    const result = await runtime.mutateBeverage({ kind: 'withdraw', commandId: this.options.createId(), expected: item.ref, updatedAt: this.options.timestamp() }, input.admissionToken);
    if (!result.ok) return result;
    if (!this.options.isAdmissionCurrent(input.admissionToken) || this.options.now() >= input.deadlineMs || !runtime.context()) return { ok: false, code: 'stale' };
    return { ok: true, value: { generation: runtime.context()!.generation, correction: { expected: result.value.ref, value } } };
  }
  async prepare(input: Parameters<IBeverageDialogue['prepare']>[0], context: MemoryOperationContext): ReturnType<IBeverageDialogue['prepare']> {
    const runtime = this.options.runtime();
    if (!runtime || runtime.context()?.generation !== context.generation) return { ok: false, code: 'stale' };
    const read = await runtime.readBeverage();
    if (!read.ok) return read;
    if (runtime.context()?.generation !== context.generation) return { ok: false, code: 'stale' };
    const item = read.value;
    const current = item?.status === 'active' && item.validity !== 'rejected' ? { value: item.value, validity: item.validity } : undefined;
    if (!current && !input.allowProposal) return { ok: true, value: null };
    return { ok: true, value: { generation: context.generation, context: { allowProposal: input.allowProposal, ...(current ? { current } : {}) }, ...(current && item ? { use: { expected: item.ref, requestId: input.requestId, userMessageId: input.userMessageId } } : {}) } };
  }
  isCurrent(capture: BeverageCapture): boolean { return this.options.runtime()?.context()?.generation === capture.generation; }
  offer(proposal: Parameters<IBeverageDialogue['offer']>[0], source: Parameters<IBeverageDialogue['offer']>[1], generation: number): BeverageOffer | null {
    if (this.options.runtime()?.context()?.generation !== generation) return null;
    this.currentOffer = { offerId: this.options.createId(), proposal, source, generation };
    return this.currentOffer;
  }
  resolveOffer(offerId: string): BeverageOffer | null {
    return this.currentOffer?.offerId === offerId && this.currentOffer.generation === this.options.runtime()?.context()?.generation ? this.currentOffer : null;
  }
}
