import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { BeveragePreference,  BeverageReceipt } from '../../application/ports/memory-beverage.interface';
import type { CompletedChatTurn } from '../../application/ports/memory-repository.interface';
import { beverageMutation,  beverageRead,  beverageReceipt } from './beverage-validation';
import { MemoryDataError,  record } from './validation';
function hash(value: unknown) {return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
/** Worker-owned single slot,  with source associations and permanent opaque receipts in existing tables. */
export class BeverageStore {
  constructor(private readonly db: Database.Database) {}
  read(): BeveragePreference|null {
    const row = this.db.prepare("SELECT * FROM memory_items WHERE category='beverage_preference'").get();
    if (!row) return null;
    const stored = record(row);
    const evidence = this.source(String(stored.source_user_id), String(stored.source_assistant_id));
    if (!evidence || !this.db.prepare('SELECT 1 FROM memory_item_sources WHERE item_id=? AND user_message_id=? AND assistant_message_id=?').get(stored.id, stored.source_user_id, stored.source_assistant_id)) return null;
    if (this.db.prepare(`SELECT 1 FROM memory_item_sources s JOIN memory_items i ON i.id=s.item_id WHERE i.category!='beverage_preference' AND (s.user_message_id=? OR s.assistant_message_id=?) LIMIT 1`).get(stored.source_user_id, stored.source_assistant_id) || this.db.prepare('SELECT 1 FROM interest_thread WHERE source_user_id=? OR source_assistant_id=?').get(stored.source_user_id, stored.source_assistant_id)) return null;
    return beverageRead({
      ref: { itemId: stored.id, revision: stored.revision }, category: stored.category,
      value: stored.beverage_value, provenance: stored.beverage_provenance, validity: stored.beverage_validity,
      manuallyCorrected: stored.beverage_manually_corrected === 1, status: stored.status,
      source: { userMessageId: stored.source_user_id, assistantMessageId: stored.source_assistant_id },
      updatedAt: stored.confirmed_at, evidenceQuote: evidence,
    });
  }
  mutate(input: unknown): BeverageReceipt {
    const command = beverageMutation(input), digest = hash(command);
    return this.db.transaction(() => {
      const old = this.db.prepare('SELECT * FROM memory_mutation_receipts WHERE command_id=?').get(command.commandId);
      if (old) {
        const receiptRow = record(old);
        if (receiptRow.digest !== digest) throw new MemoryDataError('conflict');
        return beverageReceipt({commandId: command.commandId, ref: {itemId: receiptRow.item_id, revision: receiptRow.revision}, outcome: receiptRow.outcome});
      }
      const row = this.db.prepare("SELECT id,revision,beverage_value,beverage_manually_corrected FROM memory_items WHERE category='beverage_preference'").get();
      const current = row ? record(row) : null;
      const referenceMatches = command.kind === 'save_hypothesis'
        ? current === null
        : current !== null && current.id === command.expected.itemId && current.revision === command.expected.revision;
      if (!referenceMatches) throw new MemoryDataError('conflict');
      const itemId = command.kind === 'save_hypothesis'?command.itemId: command.expected.itemId, revision = Number(current?.revision ?? 0)+1;
      if (command.kind === 'confirm' && current?.beverage_value !== command.value) throw new MemoryDataError('conflict');
      let outcome: BeverageReceipt['outcome'];
      if (command.kind === 'save_hypothesis' || command.kind === 'confirm' || command.kind === 'correct') {
        if (!this.source(command.source.userMessageId, command.source.assistantMessageId)) throw new MemoryDataError('invalid_data');
        const own = this.db.prepare('SELECT 1 FROM memory_item_sources WHERE item_id=? AND user_message_id=? AND assistant_message_id=?').get(itemId, command.source.userMessageId, command.source.assistantMessageId);
        const proposal = this.db.prepare("SELECT 1 FROM memory_mutation_receipts WHERE kind='beverage_proposal' AND outcome='hypothesis' AND user_message_id=? AND assistant_message_id=?").get(command.source.userMessageId, command.source.assistantMessageId);
        if (command.kind === 'save_hypothesis' && (this.db.prepare('SELECT 1 FROM memory_item_sources WHERE user_message_id=? OR assistant_message_id=?').get(command.source.userMessageId, command.source.assistantMessageId) || this.db.prepare('SELECT 1 FROM interest_thread WHERE source_user_id=? OR source_assistant_id=? OR answer_user_id=? OR answer_assistant_id=?').get(command.source.userMessageId, command.source.assistantMessageId, command.source.userMessageId, command.source.assistantMessageId))) throw new MemoryDataError('conflict');
        const suppressed = this.db.prepare('SELECT 1 FROM memory_suppressed_pairs WHERE user_message_id=? OR assistant_message_id=?').get(command.source.userMessageId, command.source.assistantMessageId);
        if (command.kind === 'save_hypothesis' ? !proposal : suppressed && !own) throw new MemoryDataError('conflict');
        if (command.kind === 'save_hypothesis' && this.db.prepare('SELECT 1 FROM memory_mutation_receipts WHERE item_id=?').get(itemId)) throw new MemoryDataError('conflict');
        if (command.kind === 'save_hypothesis')this.db.prepare("UPDATE memory_mutation_receipts SET outcome='consumed' WHERE kind='beverage_proposal' AND user_message_id=? AND assistant_message_id=?").run(command.source.userMessageId, command.source.assistantMessageId);
        outcome = command.kind === 'save_hypothesis'?'hypothesis': 'confirmed';
        this.db.prepare(`INSERT INTO memory_items (id,revision,status,category,label,text,confirmed_at,command_id,source_user_id,source_assistant_id,beverage_value,beverage_provenance,beverage_validity,beverage_manually_corrected)
        VALUES (?,?,'active','beverage_preference','beverage_preference',?,?, ?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,status='active',text=excluded.text,confirmed_at=excluded.confirmed_at,command_id=excluded.command_id,source_user_id=excluded.source_user_id,source_assistant_id=excluded.source_assistant_id,beverage_value=excluded.beverage_value,beverage_provenance=excluded.beverage_provenance,beverage_validity=excluded.beverage_validity,beverage_manually_corrected=excluded.beverage_manually_corrected`)
        .run(itemId, revision, command.value, command.updatedAt, command.commandId, command.source.userMessageId, command.source.assistantMessageId, command.value, command.kind === 'save_hypothesis'?'model_proposal': 'user_statement', outcome, current?.beverage_manually_corrected === 1 || command.kind === 'correct' && current?.beverage_value !== command.value ? 1 :  0);
        this.associate(itemId, command.source.userMessageId, command.source.assistantMessageId);
      }
      else if (command.kind === 'delete') {
        this.db.prepare('DELETE FROM memory_items WHERE id=?').run(itemId);
        outcome = 'deleted';
      }
      else {
        outcome = command.kind === 'reject'?'rejected': 'withdrawn';
        this.db.prepare("UPDATE memory_items SET revision=?,status='withdrawn',confirmed_at=?,command_id=?,beverage_validity=CASE WHEN ?='rejected' THEN 'rejected' ELSE beverage_validity END WHERE id=?").run(revision, command.updatedAt, command.commandId, outcome, itemId);
      }
      this.db.prepare('INSERT INTO memory_mutation_receipts (command_id,kind,item_id,revision,outcome,digest) VALUES (?,?,?,?,?,?)').run(command.commandId, 'beverage_'+command.kind, itemId, revision, outcome, digest);
      return {commandId: command.commandId, ref: {itemId, revision}, outcome};
    }).immediate();
  }
  checkTurn(turn: CompletedChatTurn): 'new'|'replay' {
    const binding = turn.beverageCorrection ?? turn.beverageUse, flag = turn.beverageProposalSource;
    if (turn.beverageCorrection && turn.beverageUse) throw new MemoryDataError('invalid_data');
    const rows = this.db.prepare('SELECT * FROM memory_mutation_receipts WHERE user_message_id IN (?,?) OR assistant_message_id IN (?,?) OR request_id=?').all(turn.user.id, turn.assistant.id, turn.user.id, turn.assistant.id, binding?.requestId ?? '');
    if (rows.length) {
      const receiptRow = record(rows[0]);
      if (rows.length !== 1 || (!binding && !flag) || receiptRow.digest !== hash(turn)) throw new MemoryDataError('conflict');
      return 'replay';
    }
    if (!binding && !flag) return 'new';
    if (this.db.prepare('SELECT 1 FROM messages WHERE id IN (?,?)').get(turn.user.id, turn.assistant.id)) throw new MemoryDataError('conflict');
    if (flag && (turn.memoryConfirmable !== true || binding || turn.interestThread)) throw new MemoryDataError('invalid_data');
    if (binding) {
      if (binding.userMessageId !== turn.user.id || turn.beverageCorrection && turn.interestThread) throw new MemoryDataError('invalid_data');
      const current = this.read();
      if (!current || current.ref.itemId !== binding.expected.itemId || current.ref.revision !== binding.expected.revision || (turn.beverageCorrection?current.status !== 'withdrawn': current.status !== 'active')) throw new MemoryDataError('conflict');
    }
    return 'new';
  }
  commitTurn(turn: CompletedChatTurn): void {
    const binding = turn.beverageCorrection ?? turn.beverageUse;
    if (!binding && !turn.beverageProposalSource)return;
    this.suppress(turn.user.id, turn.assistant.id);
    const current = binding?this.read(): null;
    let revision = current?.ref.revision ?? 1;
    if (turn.beverageCorrection && turn.memoryConfirmable === true && current) {
      revision++;
      this.db.prepare("UPDATE memory_items SET revision=?,status='active',text=?,beverage_value=?,beverage_provenance='user_statement',beverage_validity='confirmed',beverage_manually_corrected=CASE WHEN beverage_value!=? THEN 1 ELSE beverage_manually_corrected END,source_user_id=?,source_assistant_id=?,confirmed_at=? WHERE id=?").run(revision, turn.beverageCorrection.value, turn.beverageCorrection.value, turn.beverageCorrection.value, turn.user.id, turn.assistant.id, turn.user.createdAt, current.ref.itemId);
      this.associate(current.ref.itemId, turn.user.id, turn.assistant.id);
    }
    this.db.prepare('INSERT INTO memory_mutation_receipts (command_id,kind,item_id,revision,outcome,digest,request_id,user_message_id,assistant_message_id) VALUES (?,?,?,?,?,?,?,?,?)')
    .run('beverage-turn:'+turn.user.id, turn.beverageProposalSource?'beverage_proposal': 'beverage_turn', current?.ref.itemId ?? '', revision, turn.beverageCorrection && turn.memoryConfirmable === true?'confirmed': current?.status ?? 'hypothesis', hash(turn), binding?.requestId ?? null, turn.user.id, turn.assistant.id);
  }
  /** Defensive imported sharing is invalidated atomically with the ordinary card mutation. */
  invalidateCardSource(itemId: string): void {
    this.db.prepare(`UPDATE memory_items SET status='withdrawn', revision=revision+1
      WHERE category='beverage_preference' AND status='active' AND EXISTS (
        SELECT 1 FROM memory_item_sources s WHERE s.item_id=? AND
          (s.user_message_id=memory_items.source_user_id OR s.assistant_message_id=memory_items.source_assistant_id))`).run(itemId);
  }
  private source(user: string, assistant: string): string|null {const receiptRow = this.db.prepare("SELECT u.content FROM messages u JOIN messages a ON a.sequence=u.sequence+1 AND a.conversation_session_id=u.conversation_session_id WHERE u.id=? AND a.id=? AND u.role='user' AND a.role='assistant' AND u.memory_confirmable=1 AND a.memory_confirmable=1").get(user, assistant);
    return receiptRow?String(record(receiptRow).content).trim(): null;
  }
  private suppress(user: string, assistant: string) {this.db.prepare('INSERT OR IGNORE INTO memory_suppressed_pairs VALUES (?,?)').run(user, assistant);
  }
  private associate(item: string, user: string, assistant: string) {this.db.prepare('INSERT OR IGNORE INTO memory_item_sources VALUES (?,?,?)').run(item, user, assistant);
    this.suppress(user, assistant);
  }
}
