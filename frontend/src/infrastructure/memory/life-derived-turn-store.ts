import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { CompletedChatTurn } from '../../application/ports/memory-repository.interface';
import { MemoryDataError, record } from './validation-primitives';

export const LIFE_DERIVED_SCHEMA = `CREATE TABLE IF NOT EXISTS life_derived_turns (request_id TEXT PRIMARY KEY,user_message_id TEXT NOT NULL UNIQUE,assistant_message_id TEXT NOT NULL UNIQUE,digest TEXT NOT NULL);`;
const digest = (turn: CompletedChatTurn) => createHash('sha256').update(JSON.stringify(turn)).digest('hex');
/** Flat association prevents a derived answer from becoming a new independent source. */
export class LifeDerivedTurnStore {
  constructor(private readonly db: Database.Database) {}
  check(turn: CompletedChatTurn): 'new' | 'replay' {
    const use = turn.lifeDerivedUse;
    const rows = this.db.prepare('SELECT * FROM life_derived_turns WHERE request_id=? OR user_message_id IN (?,?) OR assistant_message_id IN (?,?)').all(use?.requestId ?? '', turn.user.id, turn.assistant.id, turn.user.id, turn.assistant.id);
    if (rows.length) {
      if (rows.length !== 1 || !use || record(rows[0]).digest !== digest(turn)) throw new MemoryDataError('conflict');
      return 'replay';
    }
    if (!use) return 'new';
    if (use.userMessageId !== turn.user.id) throw new MemoryDataError('invalid_data');
    if (this.db.prepare('SELECT 1 FROM messages WHERE id IN (?,?)').get(turn.user.id, turn.assistant.id)) throw new MemoryDataError('conflict');
    return 'new';
  }
  commit(turn: CompletedChatTurn): void {
    const use = turn.lifeDerivedUse;
    if (!use) return;
    this.db.prepare('INSERT INTO life_derived_turns VALUES(?,?,?,?)').run(use.requestId, turn.user.id, turn.assistant.id, digest(turn));
    this.db.prepare('INSERT OR IGNORE INTO memory_suppressed_pairs VALUES(?,?)').run(turn.user.id, turn.assistant.id);
  }
}
