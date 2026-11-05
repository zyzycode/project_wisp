import type Database from 'better-sqlite3';
import type { MemoryItem, MemoryItemRecallPage } from '../../application/ports/memory-items.interface';
import { parseMemoryCard } from '../../shared/memory-card-validation';
import { integer, record, text } from './validation-primitives';
import { itemRecallTokens } from './item-validation';

export const ITEM_RECALL_SCHEMA = 'CREATE TABLE IF NOT EXISTS memory_item_recall_build(id INTEGER PRIMARY KEY CHECK(id=1),cursor INTEGER NOT NULL,target INTEGER NOT NULL,complete INTEGER NOT NULL CHECK(complete IN(0,1)));';
const columns = 'id,revision,status,category,label,text,occurred_on AS occurredOn,confirmed_at AS confirmedAt,source_user_id,source_assistant_id,command_id';
function itemRow(value: unknown): { item: MemoryItem; commandId: string } {
  const { source_user_id, source_assistant_id, command_id, ...rest } = record(value);
  return { item: parseMemoryCard({ ...rest, source: { userMessageId: source_user_id, assistantMessageId: source_assistant_id } }), commandId: text(command_id) };
}
function words(value: string): readonly string[] { return [...new Set((value.normalize('NFC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(token => token.length >= 2 && token.length <= 64))]; }

/** Existing card index consumer only; no CRUD, extraction or new wire categories. */
export class MemoryItemRecallStore {
  constructor(private readonly db: Database.Database) {}
  ensure(): void {
    const present = this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='memory_item_terms'").get() !== undefined;
    this.db.exec('CREATE TABLE IF NOT EXISTS memory_item_terms(token TEXT NOT NULL,item_id TEXT NOT NULL REFERENCES memory_items(id) ON DELETE CASCADE,insertion_order INTEGER NOT NULL,PRIMARY KEY(token,item_id)); CREATE INDEX IF NOT EXISTS memory_terms_order ON memory_item_terms(token,insertion_order DESC,item_id);');
    this.db.exec(ITEM_RECALL_SCHEMA);
    if (!present) this.db.prepare('DELETE FROM memory_item_recall_build').run();
    const target = integer(record(this.db.prepare('SELECT coalesce(max(insertion_order),0) AS target FROM memory_items').get()).target);
    this.db.prepare('INSERT OR IGNORE INTO memory_item_recall_build VALUES(1,0,?,?)').run(target, target === 0 ? 1 : 0);
  }
  maintain(): void {
    this.db.transaction(() => {
      const state = record(this.db.prepare('SELECT cursor,target,complete FROM memory_item_recall_build WHERE id=1').get());
      if (state.complete === 1) return;
      const rows = this.db.prepare(`SELECT ${columns},insertion_order FROM memory_items WHERE insertion_order>? AND insertion_order<=? ORDER BY insertion_order LIMIT 100`).all(integer(state.cursor), integer(state.target));
      let next = integer(state.cursor);
      for (const row of rows) {
        const { insertion_order, ...data } = record(row); next = integer(insertion_order, 1);
        const { item, commandId } = itemRow(data);
        this.db.prepare('DELETE FROM memory_item_terms WHERE item_id=?').run(item.id);
        const receipt = this.db.prepare('SELECT rowid AS ordinal FROM memory_mutation_receipts WHERE command_id=?').get(commandId);
        if (item.status !== 'active' || !receipt || !this.sourceExists(item)) continue;
        const order = integer(record(receipt).ordinal, 1);
        const insert = this.db.prepare('INSERT INTO memory_item_terms VALUES(?,?,?)');
        for (const token of words(`${item.label} ${item.text}`).slice(0, 64)) insert.run(token, item.id, order);
      }
      this.db.prepare('UPDATE memory_item_recall_build SET cursor=?,complete=? WHERE id=1').run(next, rows.length < 100 || next >= integer(state.target) ? 1 : 0);
    }).immediate();
  }
  find(value: unknown): MemoryItemRecallPage {
    const tokens = itemRecallTokens(value);
    this.ensure();
    return this.db.transaction((): MemoryItemRecallPage => {
      const state = record(this.db.prepare('SELECT complete FROM memory_item_recall_build WHERE id=1').get());
      if (state.complete !== 1) return { candidates: [], coverage: 'index_building', examined: 0, fetched: 0 };
      const ids = new Set<string>(); let examined = 0;
      for (const token of tokens) {
        const rows = this.db.prepare('SELECT item_id FROM memory_item_terms WHERE token=? ORDER BY insertion_order DESC,item_id COLLATE BINARY LIMIT 12').all(token);
        examined += rows.length;
        for (const row of rows) ids.add(text(record(row).item_id));
      }
      const candidates: MemoryItemRecallPage['candidates'][number][] = [];
      for (const id of ids) {
        const row = this.db.prepare(`SELECT ${columns} FROM memory_items WHERE id=?`).get(id);
        if (!row) continue;
        const { item, commandId } = itemRow(row);
        if (item.status !== 'active' || !this.sourceExists(item)) continue;
        const receipt = this.db.prepare('SELECT rowid AS ordinal FROM memory_mutation_receipts WHERE command_id=?').get(commandId);
        if (!receipt) continue;
        const all = new Set(words(`${item.label} ${item.text}`)), label = new Set(words(item.label));
        const score = tokens.filter(token => all.has(token)).length;
        if (score) candidates.push({ item, score, labelMatches: tokens.filter(token => label.has(token)).length, confirmationOrder: integer(record(receipt).ordinal, 1) });
      }
      candidates.sort((a, b) => b.score - a.score || b.labelMatches - a.labelMatches || b.confirmationOrder - a.confirmationOrder || (a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0));
      return { candidates, coverage: 'complete', examined, fetched: ids.size };
    })();
  }
  clear(): void { this.db.exec('DELETE FROM memory_item_recall_build; INSERT INTO memory_item_recall_build VALUES(1,0,0,1);'); }
  private sourceExists(item: MemoryItem): boolean {
    return this.db.prepare(`SELECT 1 FROM messages u JOIN messages a ON a.sequence=u.sequence+1 AND a.conversation_session_id=u.conversation_session_id
      JOIN memory_item_sources s ON s.item_id=? AND s.user_message_id=u.id AND s.assistant_message_id=a.id
      WHERE u.id=? AND a.id=? AND u.role='user' AND a.role='assistant' AND u.memory_confirmable=1 AND a.memory_confirmable=1`).get(item.id, item.source.userMessageId, item.source.assistantMessageId) !== undefined;
  }
}
