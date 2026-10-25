import { isInterestThreadSourceText } from '../../application/services/memory-fact-registry';
import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { CompletedChatTurn } from '../../application/ports/memory-repository.interface';
import type { InterestThread, InterestThreadCapture, InterestThreadReceipt, InterestThreadRef } from '../../application/ports/interest-thread.interface';
import { topic, topicMutation, topicReservation, topicReceipt } from './interest-thread-validation';
import { integer, MemoryDataError, record, text, timestamp } from './validation';

function same(a: InterestThreadRef | null, b: InterestThreadRef | null): boolean { return a?.threadId === b?.threadId && a?.revision === b?.revision; }
function hash(input: unknown): string { return createHash('sha256').update(JSON.stringify(input)).digest('hex'); }
/** Worker-only owner. Reads do not terminalize or extend eligibility. */
export class InterestThreadStore {
  constructor(private readonly db: Database.Database) {}
  read(): { thread: InterestThread | null; sourceValid: boolean } {
    const row = this.db.prepare("SELECT * FROM interest_thread WHERE id='singleton'").get();
    if (row === undefined) return { thread: null, sourceValid: false };
    const r = record(row);
    const thread = topic({
      ref: { threadId: r.thread_id, revision: r.revision }, state: r.state, text: r.text,
      source: { userMessageId: r.source_user_id, assistantMessageId: r.source_assistant_id },
      statedAt: r.stated_at, confirmedAt: r.confirmed_at, eligibleAt: r.eligible_at, expiresAt: r.expires_at,
      attempt: r.attempt_request_id === null ? null : { requestId: r.attempt_request_id, userMessageId: r.attempt_user_id, attemptedAt: r.attempted_at },
      ...(r.state === 'closed' ? { reason: r.reason } : r.state === 'answered' ? { answerSource: { userMessageId: r.answer_user_id, assistantMessageId: r.answer_assistant_id } } : {}),
    });
    const source = this.source(thread.source.userMessageId, thread.source.assistantMessageId);
    return { thread, sourceValid: source !== null && isInterestThreadSourceText(source.content) && source.createdAt === thread.statedAt && (thread.state !== 'unanswered' || source.content.includes(thread.text)) };
  }
  mutate(input: unknown): InterestThreadReceipt {
    const c = topicMutation(input), digest = hash(c);
    return this.db.transaction(() => {
      const previous = this.db.prepare('SELECT * FROM interest_thread_receipts WHERE kind=? AND command_id=?').get(c.kind, c.commandId);
      if (previous !== undefined) { const r = record(previous); if (r.digest !== digest) throw new MemoryDataError('conflict'); return this.receipt(r); }
      const current = this.read().thread;
      if (!same(current?.ref ?? null, c.expected)) throw new MemoryDataError('conflict');
      let ref: InterestThreadRef;
      let outcome: InterestThreadReceipt['outcome'];
      if (c.kind === 'confirm') {
        if (this.db.prepare('SELECT 1 FROM interest_thread_receipts WHERE thread_id=? LIMIT 1').get(c.threadId)) throw new MemoryDataError('conflict');
        const source = this.source(c.source.userMessageId, c.source.assistantMessageId);
        if (!source || !isInterestThreadSourceText(source.content) || !source.content.includes(c.text)) throw new MemoryDataError('invalid_data');
        if (this.db.prepare('SELECT 1 FROM memory_suppressed_pairs WHERE user_message_id=? OR assistant_message_id=?').get(c.source.userMessageId, c.source.assistantMessageId)) throw new MemoryDataError('conflict');
        const eligibleAt = timestamp(new Date(Date.parse(c.confirmedAt) + 86400000).toISOString());
        const expiresAt = timestamp(new Date(Date.parse(c.confirmedAt) + 7 * 86400000).toISOString());
        ref = { threadId: c.threadId, revision: 1 }; outcome = 'unanswered';
        this.db.prepare("DELETE FROM interest_thread WHERE id='singleton'").run();
        this.db.prepare(`INSERT INTO interest_thread (id,thread_id,revision,state,text,source_user_id,source_assistant_id,stated_at,confirmed_at,eligible_at,expires_at)
          VALUES ('singleton',?,1,'unanswered',?,?,?,?,?,?,?)`).run(c.threadId, c.text, c.source.userMessageId, c.source.assistantMessageId, source.createdAt, c.confirmedAt, eligibleAt, expiresAt);
        this.suppress(c.source.userMessageId, c.source.assistantMessageId);
      } else {
        if (!current) throw new MemoryDataError('conflict');
        ref = { ...current.ref, revision: integer(current.ref.revision + 1, 1) };
        if (c.kind === 'delete') { this.db.prepare("DELETE FROM interest_thread WHERE id='singleton'").run(); outcome = 'deleted'; }
        else {
          if (current.state !== 'unanswered') throw new MemoryDataError('conflict');
          this.db.prepare("UPDATE interest_thread SET revision=?,state='closed',text=NULL,reason=? WHERE id='singleton'").run(ref.revision, c.reason); outcome = 'closed';
        }
      }
      this.db.prepare('INSERT INTO interest_thread_receipts (kind,command_id,digest,thread_id,revision,outcome) VALUES (?,?,?,?,?,?)').run(c.kind, c.commandId, digest, ref.threadId, ref.revision, outcome);
      return { commandId: c.commandId, ref, outcome };
    }).immediate();
  }
  capture(input: unknown, generation: number, claim: boolean): InterestThreadCapture | null {
    const c = topicReservation(input);
    return this.db.transaction(() => {
      const { thread: t, sourceValid } = this.read();
      if (!t || !same(t.ref, c.expected) || t.state !== 'unanswered' || !sourceValid || c.now < t.confirmedAt || c.now >= t.expiresAt) return null;
      let ref = t.ref;
      if (claim) {
        if (t.attempt || c.now < t.eligibleAt) return null;
        ref = { ...ref, revision: integer(ref.revision + 1, 1) };
        this.db.prepare("UPDATE interest_thread SET revision=?,attempt_request_id=?,attempt_user_id=?,attempted_at=? WHERE id='singleton'").run(ref.revision, c.requestId, c.userMessageId, c.now);
      }
      return { use: { ref, requestId: c.requestId, userMessageId: c.userMessageId, mode: claim ? 'follow_up' : 'reply' }, topic: { mode: claim ? 'follow_up' : 'reply', text: t.text, statedAt: t.statedAt }, expiresAt: t.expiresAt, generation } satisfies InterestThreadCapture;
    }).immediate();
  }
  /** Must run inside appendTurn transaction, before the legacy identical-pair shortcut. */
  checkTurn(t: CompletedChatTurn): 'new' | 'replay' {
    const binding = t.interestThread;
    const rows = this.db.prepare(`SELECT * FROM interest_thread_receipts WHERE kind='turn' AND (user_message_id IN (?,?) OR assistant_message_id IN (?,?) OR command_id=?)`)
      .all(t.user.id, t.assistant.id, t.user.id, t.assistant.id, binding?.requestId ?? '');
    if (rows.length) {
      const r = record(rows[0]);
      if (rows.length !== 1 || !binding || r.command_id !== binding.requestId || r.digest !== hash(t)) throw new MemoryDataError('conflict');
      return 'replay';
    }
    if (!binding) return 'new';
    if (binding.userMessageId !== t.user.id) throw new MemoryDataError('invalid_data');
    if (this.db.prepare('SELECT 1 FROM messages WHERE id IN (?,?) LIMIT 1').get(t.user.id, t.assistant.id)) throw new MemoryDataError('conflict');
    const { thread: current, sourceValid } = this.read();
    if (!current || !sourceValid || current.state !== 'unanswered' || !same(current.ref, binding.ref)) throw new MemoryDataError('conflict');
    if (t.user.createdAt < current.confirmedAt || t.assistant.createdAt >= current.expiresAt || t.user.createdAt >= current.expiresAt) throw new MemoryDataError('conflict');
    if (binding.mode === 'follow_up' && (current.attempt?.requestId !== binding.requestId || current.attempt.userMessageId !== binding.userMessageId)) throw new MemoryDataError('conflict');
    return 'new';
  }
  /** Called after both source messages were inserted, in the same transaction. */
  commitTurn(t: CompletedChatTurn): void {
    const binding = t.interestThread; if (!binding) return;
    this.suppress(t.user.id, t.assistant.id);
    const answered = binding.mode === 'reply' && t.memoryConfirmable === true;
    const revision = integer(binding.ref.revision + (answered ? 1 : 0), 1);
    if (answered) this.db.prepare("UPDATE interest_thread SET state='answered',revision=?,text=NULL,answer_user_id=?,answer_assistant_id=? WHERE id='singleton'").run(revision, t.user.id, t.assistant.id);
    this.db.prepare(`INSERT INTO interest_thread_receipts (kind,command_id,digest,thread_id,revision,outcome,user_message_id,assistant_message_id) VALUES ('turn',?,?,?,?,?,?,?)`)
      .run(binding.requestId, hash(t), binding.ref.threadId, revision, answered ? 'answered' : 'unanswered', t.user.id, t.assistant.id);
  }
  /** Defensive fixture/import invariant: sharing is inaccessible through ordinary confirmation. */
  invalidateCardSource(itemId: string): void {
    this.db.prepare(`UPDATE interest_thread SET state='closed',text=NULL,reason='source_changed',revision=revision+1
      WHERE state='unanswered' AND EXISTS (SELECT 1 FROM memory_item_sources s WHERE s.item_id=? AND
        (s.user_message_id=interest_thread.source_user_id OR s.assistant_message_id=interest_thread.source_assistant_id))`).run(itemId);
  }
  private source(userId: string, assistantId: string): { content: string; createdAt: string } | null {
    const row = this.db.prepare(`SELECT u.content,u.created_at FROM messages u JOIN messages a ON a.sequence=u.sequence+1 AND a.conversation_session_id=u.conversation_session_id
      WHERE u.id=? AND a.id=? AND u.role='user' AND a.role='assistant' AND u.memory_confirmable=1 AND a.memory_confirmable=1`).get(userId, assistantId);
    if (!row) return null; const r = record(row); return { content: text(r.content, 240), createdAt: text(r.created_at) };
  }
  private suppress(userId: string, assistantId: string): void { this.db.prepare('INSERT OR IGNORE INTO memory_suppressed_pairs VALUES (?,?)').run(userId, assistantId); }
  private receipt(r: Record<string, unknown>): InterestThreadReceipt {
    return topicReceipt({ commandId: r.command_id, ref: { threadId: r.thread_id, revision: r.revision }, outcome: r.outcome });
  }
}
