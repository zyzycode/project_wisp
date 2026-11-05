import type Database from 'better-sqlite3';
import type { SocialInterpretation } from '../../application/ports/social-interpretation.interface';
import { addInterruptionReport, createInterruptionInterpretation, recognizeInterruptionReport, sameInterpretationEpisode } from '../../domain/character/social-interpretation';
import { causalEpisode } from './causal-life-validation';
import { socialInterpretation } from './social-interpretation-validation';
import { integer, MemoryDataError, record, text, timestamp } from './validation-primitives';

export const SOCIAL_INTERPRETATION_SCHEMA = `
CREATE TABLE social_interpretation (singleton INTEGER PRIMARY KEY CHECK(singleton=1), revision INTEGER NOT NULL CHECK(revision>0), source_app_run_id TEXT NOT NULL, source_sequence INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('unknown','reported_accidental','reported_deliberate','contradicted')), created_at TEXT NOT NULL, expires_at TEXT NOT NULL, FOREIGN KEY(source_app_run_id,source_sequence) REFERENCES causal_life_episodes(app_run_id,sequence) ON DELETE CASCADE);
CREATE TABLE social_interpretation_reports (singleton INTEGER NOT NULL REFERENCES social_interpretation(singleton) ON DELETE CASCADE, position INTEGER NOT NULL CHECK(position IN (0,1)), conversation_session_id TEXT NOT NULL REFERENCES conversation_sessions(id) ON DELETE CASCADE, user_message_id TEXT NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE, report TEXT NOT NULL CHECK(report IN ('accidental','deliberate')), PRIMARY KEY(singleton,position));
CREATE TRIGGER social_report_deleted BEFORE DELETE ON messages BEGIN
 UPDATE social_interpretation SET status='unknown',revision=revision+1 WHERE singleton IN (SELECT singleton FROM social_interpretation_reports WHERE user_message_id=OLD.id);
 DELETE FROM social_interpretation_reports WHERE singleton IN (SELECT singleton FROM social_interpretation_reports WHERE user_message_id=OLD.id);
END;
CREATE TRIGGER social_report_corrected BEFORE UPDATE OF id,content,role,conversation_session_id,created_at ON messages WHEN OLD.id IS NOT NEW.id OR OLD.content IS NOT NEW.content OR OLD.role IS NOT NEW.role OR OLD.conversation_session_id IS NOT NEW.conversation_session_id OR OLD.created_at IS NOT NEW.created_at BEGIN
 UPDATE social_interpretation SET status='unknown',revision=revision+1 WHERE singleton IN (SELECT singleton FROM social_interpretation_reports WHERE user_message_id=OLD.id);
 DELETE FROM social_interpretation_reports WHERE singleton IN (SELECT singleton FROM social_interpretation_reports WHERE user_message_id=OLD.id);
END;
CREATE TRIGGER social_session_corrected BEFORE UPDATE OF id,app_run_id ON conversation_sessions WHEN OLD.id IS NOT NEW.id OR OLD.app_run_id IS NOT NEW.app_run_id BEGIN
 UPDATE social_interpretation SET status='unknown',revision=revision+1 WHERE singleton IN (SELECT singleton FROM social_interpretation_reports WHERE conversation_session_id=OLD.id);
 DELETE FROM social_interpretation_reports WHERE conversation_session_id=OLD.id;
END;
CREATE TRIGGER social_episode_corrected BEFORE UPDATE ON causal_life_episodes WHEN OLD.payload IS NOT NEW.payload OR OLD.app_run_id IS NOT NEW.app_run_id OR OLD.sequence IS NOT NEW.sequence BEGIN
 DELETE FROM social_interpretation WHERE source_app_run_id=OLD.app_run_id AND source_sequence=OLD.sequence;
END;
`;
function identical(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }

export class SocialInterpretationStore {
  constructor(private readonly db: Database.Database) {}
  read(value: unknown): SocialInterpretation | null {
    const now = timestamp(value);
    return this.db.transaction(() => this.current(now)).immediate();
  }
  replace(value: unknown): void {
    const p = record(value, ['value', 'expectedRevision', 'now']), now = timestamp(p.now), desired = socialInterpretation(p.value);
    const expected = p.expectedRevision === null ? null : integer(p.expectedRevision, 1);
    this.db.transaction(() => {
      const current = this.current(now);
      if (identical(current, desired)) return;
      if ((current?.revision ?? null) !== expected) throw new MemoryDataError('conflict');
      const episode = this.sourceEpisode(desired);
      const base = createInterruptionInterpretation(episode, (current?.revision ?? 0) + 1);
      if (!base || desired.createdAt !== base.createdAt || desired.expiresAt !== base.expiresAt
        || now < base.createdAt || now >= base.expiresAt) throw new MemoryDataError('invalid_data');
      if (!current || !sameInterpretationEpisode(current.episode, desired.episode)) {
        if (current?.episode.appRunId === desired.episode.appRunId && current.episode.sequence >= desired.episode.sequence) throw new MemoryDataError('conflict');
        if (!identical(base, desired)) throw new MemoryDataError('invalid_data');
      } else {
        if (Date.parse(now) - Date.parse(base.createdAt) > 300000) throw new MemoryDataError('conflict');
        const newSource = desired.reports.find(source => !current.reports.some(old => old.userMessageId === source.userMessageId));
        if (!newSource || !identical(addInterruptionReport(current, newSource), desired)) throw new MemoryDataError('invalid_data');
      }
      if (!this.reportsValid(desired, now)) throw new MemoryDataError('conflict');
      this.save(desired);
    }).immediate();
  }
  clear(value: unknown): void {
    const expected = integer(value, 1);
    this.db.transaction(() => {
      const row = this.db.prepare('SELECT revision FROM social_interpretation WHERE singleton=1').get();
      if (!row) return;
      if (record(row).revision !== expected) throw new MemoryDataError('conflict');
      this.db.prepare('DELETE FROM social_interpretation WHERE singleton=1').run();
    }).immediate();
  }
  clearAll(): void { this.db.prepare('DELETE FROM social_interpretation').run(); }
  private current(now: string): SocialInterpretation | null {
    const row = this.db.prepare('SELECT * FROM social_interpretation WHERE singleton=1').get();
    if (!row) return null;
    const p = record(row), reports = this.db.prepare('SELECT conversation_session_id,user_message_id,report FROM social_interpretation_reports WHERE singleton=1 ORDER BY position LIMIT 3').all();
    const current = socialInterpretation({ revision: p.revision,
      episode: { appRunId: p.source_app_run_id, sequence: p.source_sequence, revision: 1 }, status: p.status,
      createdAt: p.created_at, expiresAt: p.expires_at, reports: reports.map(value => { const source = record(value); return {
        conversationSessionId: source.conversation_session_id, userMessageId: source.user_message_id, revision: 1, report: source.report,
      }; }) });
    let validEpisode = false;
    try {
      const source = this.sourceEpisode(current), base = createInterruptionInterpretation(source, current.revision);
      validEpisode = base !== null && current.createdAt === base.createdAt && current.expiresAt === base.expiresAt;
    } catch (error) { if (!(error instanceof MemoryDataError)) throw error; }
    if (!validEpisode || now < current.createdAt || now >= current.expiresAt) { this.clearAll(); return null; }
    if (this.reportsValid(current, now)) return current;
    const unknown: SocialInterpretation = { ...current, revision: current.revision + 1, status: 'unknown', reports: [] };
    this.save(unknown); return unknown;
  }
  private sourceEpisode(value: SocialInterpretation) {
    const row = this.db.prepare('SELECT payload FROM causal_life_episodes WHERE app_run_id=? AND sequence=?').get(value.episode.appRunId, value.episode.sequence);
    if (!row) throw new MemoryDataError('conflict');
    return causalEpisode(JSON.parse(text(record(row).payload, 4096)));
  }
  private reportsValid(value: SocialInterpretation, now: string): boolean {
    const read = this.db.prepare('SELECT m.role,m.content,m.created_at,s.app_run_id FROM messages m JOIN conversation_sessions s ON s.id=m.conversation_session_id WHERE m.id=? AND m.conversation_session_id=?');
    return value.reports.every(source => {
      const row = read.get(source.userMessageId, source.conversationSessionId);
      if (!row) return false;
      const p = record(row), occurred = Date.parse(value.createdAt), created = Date.parse(timestamp(p.created_at));
      return p.role === 'user' && p.app_run_id === value.episode.appRunId && typeof p.content === 'string'
        && recognizeInterruptionReport(p.content) === source.report && created >= occurred && created <= Date.parse(now) && created - occurred <= 300000;
    });
  }
  private save(value: SocialInterpretation): void {
    this.db.prepare('INSERT INTO social_interpretation VALUES (1,?,?,?,?,?,?) ON CONFLICT(singleton) DO UPDATE SET revision=excluded.revision,source_app_run_id=excluded.source_app_run_id,source_sequence=excluded.source_sequence,status=excluded.status,created_at=excluded.created_at,expires_at=excluded.expires_at')
      .run(value.revision, value.episode.appRunId, value.episode.sequence, value.status, value.createdAt, value.expiresAt);
    this.db.prepare('DELETE FROM social_interpretation_reports WHERE singleton=1').run();
    const insert = this.db.prepare('INSERT INTO social_interpretation_reports VALUES (1,?,?,?,?)');
    value.reports.forEach((source, index) => insert.run(index, source.conversationSessionId, source.userMessageId, source.report));
  }
}
