import { BeverageStore } from './beverage-store';
import { InterestThreadStore } from './interest-thread-store';
import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { MemoryItem, MemoryItemMutation, MemoryItemPage, MemoryItemReceipt } from '../../application/ports/memory-items.interface';
import { parseMemoryCard } from '../../shared/memory-card-validation';
import { itemListQuery, itemMutation, itemReceipt } from './item-validation';
import { integer, MemoryDataError, record } from './validation';

const columns = 'id, revision, status, category, label, text, occurred_on AS occurredOn, confirmed_at AS confirmedAt, source_user_id, source_assistant_id';
function parseRow(input: unknown): MemoryItem {
  const { source_user_id, source_assistant_id, ...rest } = record(input);
  return parseMemoryCard({ ...rest, source: { userMessageId: source_user_id, assistantMessageId: source_assistant_id } });
}
function tokens(item: MemoryItem): string[] {
  return [...new Set(`${item.label} ${item.text}`.normalize('NFC').toLowerCase().match(/[\p{L}\p{N}]+/gu)?.filter(token => token.length >= 2 && token.length <= 64) ?? [])].slice(0, 64);
}
function digest(command: MemoryItemMutation): string {
  const common = [command.kind, command.commandId, command.itemId, command.expectedRevision];
  const args = command.kind === 'confirm' || command.kind === 'update' ? [...common, command.confirmed, command.content.category, command.content.label, command.content.text, command.content.occurredOn, command.source.userMessageId, command.source.assistantMessageId] : common;
  return createHash('sha256').update(JSON.stringify(args)).digest('hex');
}
/** All methods execute inside the existing worker, never on Main. */
export class MemoryItemStore {
  constructor(private readonly db: Database.Database) {}
  mutate(input: unknown): MemoryItemReceipt {
    const c = itemMutation(input), hash = digest(c);
    return this.db.transaction(() => {
      const previous = this.db.prepare('SELECT command_id AS commandId, item_id AS itemId, revision, outcome, digest FROM memory_mutation_receipts WHERE command_id = ?').get(c.commandId);
      if (previous !== undefined) {
        const { digest: storedDigest, ...receipt } = record(previous);
        if (storedDigest !== hash) throw new MemoryDataError('conflict');
        return itemReceipt(receipt);
      }
      const row = this.db.prepare(`SELECT ${columns} FROM memory_items WHERE id = ? AND category!='beverage_preference'`).get(c.itemId);
      const current = row === undefined ? null : parseRow(row);
      if (c.kind === 'confirm' && this.db.prepare('SELECT 1 FROM memory_mutation_receipts WHERE item_id = ? LIMIT 1').get(c.itemId)) throw new MemoryDataError('conflict');
      if (c.kind === 'confirm' ? current !== null : current === null || current.revision !== c.expectedRevision) throw new MemoryDataError('conflict');
      const revision = (current?.revision ?? 0) + 1;
      if (current) {
        new InterestThreadStore(this.db).invalidateCardSource(c.itemId);
        new BeverageStore(this.db).invalidateCardSource(c.itemId);
      }
      if (c.kind === 'confirm' || c.kind === 'update') {
        this.validateSource(c);
        this.db.prepare(`INSERT INTO memory_items (id, revision, status, category, label, text, occurred_on, confirmed_at, command_id, source_user_id, source_assistant_id)
          VALUES (?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision, status='active', category=excluded.category,
          label=excluded.label, text=excluded.text, occurred_on=excluded.occurred_on, confirmed_at=excluded.confirmed_at, command_id=excluded.command_id,
          source_user_id=excluded.source_user_id, source_assistant_id=excluded.source_assistant_id`)
          .run(c.itemId, revision, c.content.category, c.content.label, c.content.text, c.content.occurredOn, c.confirmedAt, c.commandId, c.source.userMessageId, c.source.assistantMessageId);
        this.db.prepare('INSERT OR IGNORE INTO memory_item_sources VALUES (?, ?, ?)').run(c.itemId, c.source.userMessageId, c.source.assistantMessageId);
        this.db.prepare('INSERT OR IGNORE INTO memory_suppressed_pairs VALUES (?, ?)').run(c.source.userMessageId, c.source.assistantMessageId);
        this.db.prepare('DELETE FROM memory_item_terms WHERE item_id = ?').run(c.itemId);
        const item = parseRow(this.db.prepare(`SELECT ${columns} FROM memory_items WHERE id = ? AND category!='beverage_preference'`).get(c.itemId));
        const order = integer(record(this.db.prepare('SELECT insertion_order FROM memory_items WHERE id = ?').get(c.itemId)).insertion_order, 1);
        const insert = this.db.prepare('INSERT INTO memory_item_terms VALUES (?, ?, ?)');
        for (const token of tokens(item)) insert.run(token, c.itemId, order);
      } else if (c.kind === 'withdraw') {
        this.db.prepare("UPDATE memory_items SET status='withdrawn', revision=? WHERE id=?").run(revision, c.itemId);
        this.db.prepare('DELETE FROM memory_item_terms WHERE item_id=?').run(c.itemId);
      } else this.db.prepare('DELETE FROM memory_items WHERE id=?').run(c.itemId);
      const outcome: MemoryItemReceipt['outcome'] = c.kind === 'delete' ? 'deleted' : c.kind === 'withdraw' ? 'withdrawn' : 'active';
      this.db.prepare('INSERT INTO memory_mutation_receipts (command_id,kind,item_id,revision,outcome,digest) VALUES (?, ?, ?, ?, ?, ?)').run(c.commandId, c.kind, c.itemId, revision, outcome, hash);
      return { commandId: c.commandId, itemId: c.itemId, revision, outcome };
    }).immediate();
  }
  list(input: unknown): MemoryItemPage {
    const q = itemListQuery(input);
    const rows = this.db.prepare(`SELECT ${columns}, insertion_order FROM memory_items WHERE category!='beverage_preference' AND (? IS NULL OR insertion_order < ?) ORDER BY insertion_order DESC LIMIT ?`).all(q.cursor, q.cursor, q.limit + 1);
    const page = rows.slice(0, q.limit);
    const items = page.map(row => { const { insertion_order: _order, ...rest } = record(row); return parseRow(rest); });
    const last = page[page.length - 1];
    return { items, nextCursor: rows.length > q.limit && last ? integer(record(last).insertion_order, 1) : null };
  }
  private validateSource(c: Extract<MemoryItemMutation, { kind: 'confirm' | 'update' }>): void {
    // Adjacency and roles prove one committed pair, not two arbitrary message IDs.
    const pair = this.db.prepare(`SELECT u.id FROM messages u JOIN messages a ON a.sequence = u.sequence + 1 AND a.conversation_session_id = u.conversation_session_id
      WHERE u.id=? AND a.id=? AND u.role='user' AND a.role='assistant' AND u.memory_confirmable=1 AND a.memory_confirmable=1`).get(c.source.userMessageId, c.source.assistantMessageId);
    if (!pair) throw new MemoryDataError('invalid_data');
    const suppressed = this.db.prepare('SELECT 1 FROM memory_suppressed_pairs WHERE user_message_id=? OR assistant_message_id=?').get(c.source.userMessageId, c.source.assistantMessageId);
    const own = c.kind === 'update' && this.db.prepare('SELECT 1 FROM memory_item_sources WHERE item_id=? AND user_message_id=? AND assistant_message_id=?').get(c.itemId, c.source.userMessageId, c.source.assistantMessageId);
    if (suppressed && !own) throw new MemoryDataError('conflict');
  }
}
