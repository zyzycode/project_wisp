import type { IInterestThreadDialogue, IInterestThreadRepository, InterestThread, InterestThreadCapture, InterestThreadRef } from '../ports/interest-thread.interface';
import type { MemoryFailureCode, MemoryOperationContext, MemoryResult } from '../ports/memory-repository.interface';
import type { MemoryLifecycle } from './memory-lifecycle';

const greetings = new Set(['привет', 'доброе утро', 'добрый день', 'добрый вечер', 'как дела', 'давай поболтаем', 'hi', 'hello', 'good morning', 'good afternoon', 'good evening', 'how are you', "let's chat"]);
const refusals = new Set(['не хочу обсуждать', 'не спрашивай об этом', 'не спрашивай', "i don't want to discuss this", "don't ask about this", "don't ask again"]);
export function isTopicRefusal(text: string): boolean { return refusals.has(text.trim().toLowerCase()); }
export function isTopicGreeting(text: string): boolean { return greetings.has(text.trim().toLowerCase().replace(/[.!?]+$/u, '')); }
function matches(a: InterestThreadRef | undefined, b: InterestThreadRef): boolean { return a?.threadId === b.threadId && a.revision === b.revision; }
export class InterestThreadDialogue implements IInterestThreadDialogue {
  constructor(private readonly options: {
    readonly runtime: () => Pick<MemoryLifecycle, 'context' | 'currentGeneration' | 'mutateInterestThread'> | null;
    readonly repository: IInterestThreadRepository;
    readonly now: () => number;
    readonly timestamp: () => string;
    readonly createId: () => string;
    readonly notice: () => void;
    readonly onFailure?: (code: MemoryFailureCode) => void;
    readonly isTurnCurrent: (requestId: string) => boolean;
    readonly isAdmissionCurrent: (token: object) => boolean;
  }) {}
  async admit(input: Parameters<IInterestThreadDialogue['admit']>[0], context: MemoryOperationContext): ReturnType<IInterestThreadDialogue['admit']> {
    const runtime = this.options.runtime();
    const read = await this.safe(() => this.options.repository.read(context));
    if (!read.ok) return read;
    if ((input.admissionToken && !this.options.isAdmissionCurrent(input.admissionToken)) || !runtime || runtime.context()?.generation !== context.generation || this.options.now() >= input.deadlineMs) return { ok: false, code: 'stale' };
    const t = read.value.thread;
    if (!t || t.state !== 'unanswered') return { ok: true, value: { kind: 'continue', generation: context.generation } };
    const scoped = matches(input.replyTo, t.ref) || matches(input.lastOffered, t.ref);
    const declined = scoped && isTopicRefusal(input.text);
    const reason = !read.value.sourceValid ? 'source_changed' : Date.parse(this.options.timestamp()) >= Date.parse(t.expiresAt) ? 'expired' : declined ? 'declined' : null;
    if (!reason) return { ok: true, value: { kind: 'continue', generation: context.generation } };
    const result = await runtime.mutateInterestThread({ kind: 'close', commandId: this.options.createId(), expected: t.ref, reason }, input.admissionToken);
    if (!result.ok) return result;
    if (input.admissionToken && !this.options.isAdmissionCurrent(input.admissionToken)) return { ok: false, code: 'stale' };
    if (declined) this.options.notice();
    return { ok: true, value: { kind: declined ? 'closed' : 'continue', generation: runtime.currentGeneration() } };
  }
  async prepare(input: Parameters<IInterestThreadDialogue['prepare']>[0], context: MemoryOperationContext): Promise<MemoryResult<InterestThreadCapture | null>> {
    const read = await this.safe(() => this.options.repository.read(context));
    if (!read.ok) return read;
    const t = read.value.thread, timestamp = this.options.timestamp();
    if (!this.options.isTurnCurrent(input.requestId) || !t || !read.value.sourceValid || t.state !== 'unanswered' || this.options.runtime()?.context()?.generation !== context.generation || this.options.now() >= input.deadlineMs || !this.live(t, timestamp)) return { ok: true, value: null };
    const command = { expected: t.ref, requestId: input.requestId, userMessageId: input.userMessageId, now: timestamp };
    if (input.replyTo) return matches(input.replyTo, t.ref) ? this.safe(() => this.options.repository.captureReply(command, context)) : { ok: true, value: null };
    if (!isTopicGreeting(input.text) || t.attempt || Date.parse(timestamp) < Date.parse(t.eligibleAt)) return { ok: true, value: null };
    return this.safe(() => this.options.repository.claim(command, context));
  }
  isCurrent(capture: InterestThreadCapture): boolean { return this.options.isTurnCurrent(capture.use.requestId) && this.options.runtime()?.context()?.generation === capture.generation && Date.parse(this.options.timestamp()) < Date.parse(capture.expiresAt); }
  private async safe<T>(operation: () => Promise<MemoryResult<T>>): Promise<MemoryResult<T>> {
    let result: MemoryResult<T>;
    try { result = await operation(); } catch { result = { ok: false, code: 'unavailable' }; }
    if (!result.ok) this.options.onFailure?.(result.code);
    return result;
  }
  private live(t: InterestThread, now: string): boolean { return Date.parse(now) >= Date.parse(t.confirmedAt) && Date.parse(now) < Date.parse(t.expiresAt); }
}
