import Database from 'better-sqlite3';
import type { MemoryResult } from '../../application/ports/memory-repository.interface';
import { command, failure, type Command } from './protocol';
import { initializeSchema } from './schema';
import * as v from './validation';

const messageColumns = 'id, conversation_session_id AS conversationSessionId, role, content, created_at AS createdAt';
const sessionColumns = 'id, app_run_id AS appRunId, started_at AS startedAt, ended_at AS endedAt';
const factColumns = 'id, fact_key AS factKey, fact_value AS factValue, confidence, source_message_id AS sourceMessageId, created_at AS createdAt, updated_at AS updatedAt';
const episodeColumns = 'app_run_id AS appRunId, activity_run_id AS activityRunId, kind, outcome, play_completed AS playCompleted, executed_ms AS executedMs, ended_at AS endedAt';
function identical(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }

/** Only constructed inside the Infrastructure worker (tests exercise the same real connection). */
export class SqliteMemoryStore {
  private generation = 0;
  private unavailable = false;
  private constructor(private readonly db: Database.Database) {}

  static open(filename: string, now: string): SqliteMemoryStore {
    const db = new Database(filename);
    try {
      initializeSchema(db, now);
      const store = new SqliteMemoryStore(db);
      store.closeSessions(now);
      return store;
    } catch (error) { db.close(); throw error; }
  }

  execute(input: unknown): MemoryResult<unknown> {
    if (this.unavailable) return { ok: false, code: 'unavailable' };
    try {
      const c = command(input);
      if (c.operation === 'close') { this.db.close(); this.unavailable = true; return { ok: true, value: undefined }; }
      if (c.operation === 'clear') {
        if (c.generation !== this.generation + 1) return { ok: false, code: 'stale' };
        // The barrier survives rollback: old callbacks never regain write access.
        this.generation = c.generation;
      } else if (c.generation !== this.generation) return { ok: false, code: 'stale' };
      return { ok: true, value: this.dispatch(c) };
    } catch (error) {
      const result = failure(error);
      if (!result.ok && ['unavailable', 'storage_full', 'corrupt', 'io_error', 'unsupported_version'].includes(result.code)) this.unavailable = true;
      return result;
    }
  }
  close(): void { if (this.db.open) this.db.close(); this.unavailable = true; }

  private dispatch(c: Command): unknown {
    switch (c.operation) {
      case 'appendTurn': return this.appendTurn(c.payload);
      case 'getRecent': return this.db.prepare(`SELECT ${messageColumns} FROM (SELECT * FROM messages ORDER BY sequence DESC LIMIT ?) ORDER BY sequence`).all(v.integer(c.payload, 1, 100)).map(v.message);
      case 'closeSession': {
        const p = v.record(c.payload);
        this.db.prepare('UPDATE conversation_sessions SET ended_at = max(started_at, ?) WHERE id = ? AND ended_at IS NULL').run(v.timestamp(p.endedAt), v.text(p.sessionId)); return;
      }
      case 'closeUnfinishedSessions': return this.closeSessions(v.timestamp(c.payload));
      case 'upsertFact': return this.upsertFact(c.payload);
      case 'removeFact': this.db.prepare('DELETE FROM user_facts WHERE fact_key = ?').run(v.text(c.payload)); return;
      case 'listFacts': return this.db.prepare(`SELECT ${factColumns} FROM user_facts ORDER BY fact_key COLLATE BINARY LIMIT ?`).all(v.integer(c.payload, 1, 100)).map(v.fact);
      case 'getRecentEpisodes': return this.db.prepare(`SELECT ${episodeColumns} FROM game_episodes ORDER BY rowid DESC LIMIT ?`).all(v.integer(c.payload, 1, 20)).map(row => { const r = v.record(row); return v.episode({ ...r, playCompleted: r.playCompleted === 1 }); });
      case 'appendEpisode': return this.appendEpisode(c.payload);
      case 'loadSnapshot': {
        const row = this.db.prepare("SELECT snapshot_json, updated_at FROM character_state WHERE id = 'singleton'").get();
        if (row === undefined) return null;
        const r = v.record(row);
        const raw = v.text(r.snapshot_json, 1024 * 1024);
        const envelope = v.record(JSON.parse(raw), ['snapshotVersion', 'state']);
        return v.snapshot({ ...envelope, updatedAt: r.updated_at });
      }
      case 'saveSnapshot': {
        const snapshot = v.snapshot(c.payload);
        if (snapshot.snapshotVersion !== 1) throw new v.MemoryDataError('invalid_data');
        this.db.prepare("INSERT INTO character_state VALUES ('singleton', ?, ?) ON CONFLICT(id) DO UPDATE SET snapshot_json = excluded.snapshot_json, updated_at = excluded.updated_at")
          .run(JSON.stringify({ snapshotVersion: 1, state: snapshot.state }), snapshot.updatedAt); return;
      }
      case 'clear': return this.db.transaction(() => { this.db.exec('DELETE FROM user_facts; DELETE FROM game_episodes; DELETE FROM messages; DELETE FROM conversation_sessions; DELETE FROM character_state;'); }).immediate();
      case 'close': return;
    }
  }

  private closeSessions(now: string): void {
    this.db.prepare('UPDATE conversation_sessions SET ended_at = max(started_at, ?) WHERE ended_at IS NULL').run(now);
  }
  private appendTurn(payload: unknown): void {
    const t = v.turn(payload);
    this.db.transaction(() => {
      const existing = this.db.prepare(`SELECT ${sessionColumns} FROM conversation_sessions WHERE id = ? OR app_run_id = ?`).all(t.session.id, t.session.appRunId);
      const messages = this.db.prepare(`SELECT ${messageColumns} FROM messages WHERE id IN (?, ?) ORDER BY sequence`).all(t.user.id, t.assistant.id).map(v.message);
      if (existing.length > 1) throw new v.MemoryDataError('conflict');
      const s = existing[0] === undefined ? undefined : v.session(existing[0]);
      if (s && (s.id !== t.session.id || s.appRunId !== t.session.appRunId || s.startedAt !== t.session.startedAt)) throw new v.MemoryDataError('conflict');
      if (messages.length !== 0) {
        if (s && messages.length === 2 && identical(messages[0], t.user) && identical(messages[1], t.assistant)) return;
        throw new v.MemoryDataError('conflict');
      }
      if (s?.endedAt !== null && s !== undefined) throw new v.MemoryDataError('conflict');
      if (!s) {
        if (t.session.startedAt !== t.user.createdAt) throw new v.MemoryDataError('invalid_data');
        this.closeSessions(t.user.createdAt);
        this.db.prepare('INSERT INTO conversation_sessions VALUES (?, ?, ?, NULL)').run(t.session.id, t.session.appRunId, t.session.startedAt);
      }
      const insert = this.db.prepare('INSERT INTO messages (id, conversation_session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)');
      for (const m of [t.user, t.assistant]) insert.run(m.id, m.conversationSessionId, m.role, m.content, m.createdAt);
    }).immediate();
  }
  private upsertFact(payload: unknown): unknown {
    const f = v.fact(payload);
    return this.db.transaction(() => {
      this.db.prepare(`INSERT INTO user_facts VALUES (?, ?, ?, ?, ?, ?, max(?, ?)) ON CONFLICT(fact_key) DO UPDATE SET fact_value = excluded.fact_value, confidence = excluded.confidence, source_message_id = excluded.source_message_id, updated_at = max(user_facts.created_at, ?)`)
        .run(f.id, f.factKey, f.factValue, f.confidence, f.sourceMessageId, f.createdAt, f.createdAt, f.updatedAt, f.updatedAt);
      return v.fact(this.db.prepare(`SELECT ${factColumns} FROM user_facts WHERE fact_key = ?`).get(f.factKey));
    }).immediate();
  }
  private appendEpisode(payload: unknown): void {
    const e = v.episode(payload);
    this.db.transaction(() => {
      const row = this.db.prepare(`SELECT ${episodeColumns} FROM game_episodes WHERE app_run_id = ? AND activity_run_id = ?`).get(e.appRunId, e.activityRunId);
      if (row !== undefined) {
        const r = v.record(row);
        if (r.playCompleted !== 1) throw new v.MemoryDataError('invalid_data');
        if (!identical(v.episode({ ...r, playCompleted: true }), e)) throw new v.MemoryDataError('conflict');
        return;
      }
      this.db.prepare('INSERT INTO game_episodes VALUES (?, ?, ?, ?, 1, ?, ?)').run(e.appRunId, e.activityRunId, e.kind, e.outcome, e.executedMs, e.endedAt);
    }).immediate();
  }
}
