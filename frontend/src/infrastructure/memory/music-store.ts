import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { MusicDialogueSource, MusicDiscussionSample, MusicInterestEvidence, MusicUserPreference } from '../../application/ports/music-interest.interface';
import { recognizeMusicMessage } from '../../domain/character/music-interest';
import { musicPreference, musicSample } from './music-validation';
import { MemoryDataError, record, text, timestamp, integer } from './validation-primitives';
const TTL = 30 * 86400000;
interface Pair { readonly text: string; readonly userAt: string; readonly assistantAt: string; readonly sequence: number; readonly intention: boolean; readonly consumed: string | null; readonly preferenceConsumed: boolean }
/** Bounded records are derived only from exact canonical dialogue pairs, never recall output. */
export class MusicInterestStore {
  constructor(private readonly db: Database.Database) {}
  private clock(now: string): void {
    timestamp(now);
    const old = this.db.prepare('SELECT last_clock FROM music_clock WHERE id=1').get();
    if (old && timestamp(record(old).last_clock) > now) throw new MemoryDataError('conflict');
    this.db.prepare('INSERT INTO music_clock VALUES(1,?) ON CONFLICT(id) DO UPDATE SET last_clock=excluded.last_clock').run(now);
  }
  private pair(source: MusicDialogueSource, now: string): Pair {
    const rows = this.db.prepare('SELECT id,conversation_session_id,role,content,created_at,sequence,memory_confirmable,music_intention,music_sample_digest,music_preference_consumed FROM messages WHERE id IN (?,?) ORDER BY sequence').all(source.userMessageId, source.assistantMessageId).map(value => record(value));
    if (rows.length !== 2) throw new MemoryDataError('conflict');
    const u = rows[0]!, a = rows[1]!;
    if (u.id !== source.userMessageId || a.id !== source.assistantMessageId || u.role !== 'user' || a.role !== 'assistant'
      || u.conversation_session_id !== source.conversationSessionId || a.conversation_session_id !== source.conversationSessionId
      || u.memory_confirmable !== 1 || a.memory_confirmable !== 1 || integer(a.sequence,1) !== integer(u.sequence,1) + 1) throw new MemoryDataError('conflict');
    const userAt = timestamp(u.created_at), assistantAt = timestamp(a.created_at);
    if (userAt > assistantAt || assistantAt > now) throw new MemoryDataError('invalid_data');
    return { text: text(u.content,240), userAt, assistantAt, sequence: integer(u.sequence,1), intention: u.music_intention === 1,
      preferenceConsumed: u.music_preference_consumed === 1, consumed: u.music_sample_digest === null ? null : text(u.music_sample_digest,64) };
  }
  private validSample(sample: MusicDiscussionSample, now: string): { opening: Pair; continuation: Pair } {
    const opening = this.pair(sample.opening, now), continuation = this.pair(sample.continuation, now);
    const first = recognizeMusicMessage(opening.text), next = recognizeMusicMessage(continuation.text);
    if (!opening.intention || first?.kind !== 'opening' || next?.kind !== 'continuation' || first.topic !== sample.topic || next.topic !== sample.topic
      || continuation.sequence !== opening.sequence + 2 || continuation.assistantAt !== sample.occurredAt
      || Date.parse(continuation.assistantAt) - Date.parse(opening.userAt) >= 300000 || continuation.userAt < opening.assistantAt) throw new MemoryDataError('conflict');
    return { opening, continuation };
  }
  private validPreference(p: MusicUserPreference, now: string): void {
    const pair = this.pair(p.source,now), recognized = recognizeMusicMessage(pair.text);
    if (recognized?.kind !== 'preference' || recognized.topic !== p.topic || recognized.disposition !== p.disposition || p.occurredAt !== pair.userAt) throw new MemoryDataError('conflict');
  }
  private prune(now: string): void {
    const before = new Date(Date.parse(now) - TTL).toISOString();
    this.db.prepare('DELETE FROM music_samples WHERE occurred_at<=?').run(before);
    this.db.prepare('DELETE FROM music_user_preferences WHERE occurred_at<=?').run(before);
  }
  read(now: string): MusicInterestEvidence {
    return this.db.transaction(() => {
      this.clock(now); this.prune(now);
      const samples: MusicDiscussionSample[] = [], userPreferences: MusicUserPreference[] = [];
      const rows = this.db.prepare('SELECT * FROM music_samples ORDER BY occurred_at,opening_id LIMIT 49').all();
      if (rows.length > 48) throw new MemoryDataError('invalid_data');
      for (const value of rows) {
        const row = record(value);
        try { const sample = musicSample(JSON.parse(text(row.payload,2048))); if (sample.occurredAt > now) throw new MemoryDataError('invalid_data'); if (row.opening_id !== sample.opening.userMessageId || row.continuation_id !== sample.continuation.userMessageId || row.topic !== sample.topic || row.day !== sample.occurredAt.slice(0,10) || row.occurred_at !== sample.occurredAt) throw new TypeError('Invalid music metadata'); this.validSample(sample,now); samples.push(sample); }
        catch (error) { if (!(error instanceof MemoryDataError) || error.code !== 'conflict') throw error; this.db.prepare('DELETE FROM music_samples WHERE opening_id=?').run(text(row.opening_id)); }
      }
      const preferences = this.db.prepare('SELECT * FROM music_user_preferences LIMIT 5').all();
      if (preferences.length > 4) throw new MemoryDataError('invalid_data');
      for (const value of preferences) {
        const row = record(value);
        try { const p = musicPreference(JSON.parse(text(row.payload,1024))); if (row.topic !== p.topic || row.occurred_at !== p.occurredAt) throw new TypeError('Invalid preference metadata'); this.validPreference(p,now); userPreferences.push(p); }
        catch (error) { if (!(error instanceof MemoryDataError) || error.code !== 'conflict') throw error; this.db.prepare('DELETE FROM music_user_preferences WHERE topic=?').run(text(row.topic)); }
      }
      return { samples, userPreferences };
    }).immediate();
  }
  append(sample: MusicDiscussionSample, now: string): void {
    this.db.transaction(() => {
      this.clock(now); this.prune(now);
      if (Date.parse(now) - Date.parse(sample.occurredAt) >= TTL) throw new MemoryDataError('invalid_data');
      const { opening, continuation } = this.validSample(sample,now), digest = createHash('sha256').update(JSON.stringify(sample)).digest('hex');
      if (opening.consumed !== null || continuation.consumed !== null) {
        if (opening.consumed === digest && continuation.consumed === digest) return;
        throw new MemoryDataError('conflict');
      }
      this.db.prepare('INSERT INTO music_samples VALUES(?,?,?,?,?,?)').run(sample.opening.userMessageId, sample.continuation.userMessageId, sample.topic, sample.occurredAt.slice(0,10), sample.occurredAt, JSON.stringify(sample));
      this.db.prepare('UPDATE messages SET music_sample_digest=? WHERE id IN (?,?)').run(digest,sample.opening.userMessageId,sample.continuation.userMessageId);
      this.db.prepare('DELETE FROM music_samples WHERE topic=? AND opening_id NOT IN (SELECT opening_id FROM music_samples WHERE topic=? ORDER BY occurred_at DESC,opening_id DESC LIMIT 12)').run(sample.topic,sample.topic);
    }).immediate();
  }
  preference(p: MusicUserPreference, now: string): void {
    this.db.transaction(() => {
      this.clock(now); this.prune(now); this.validPreference(p,now);
      if (Date.parse(now) - Date.parse(p.occurredAt) >= TTL) throw new MemoryDataError('invalid_data');
      if (this.pair(p.source,now).preferenceConsumed) return;
      this.db.prepare('UPDATE messages SET music_preference_consumed=1 WHERE id=?').run(p.source.userMessageId);
      const existing = this.db.prepare('SELECT occurred_at,payload FROM music_user_preferences WHERE topic=?').get(p.topic);
      if (existing && text(record(existing).occurred_at) > p.occurredAt) return;
      this.db.prepare('INSERT INTO music_user_preferences VALUES(?,?,?) ON CONFLICT(topic) DO UPDATE SET occurred_at=excluded.occurred_at,payload=excluded.payload').run(p.topic,p.occurredAt,JSON.stringify(p));
    }).immediate();
  }
  clear(): void { this.db.exec('DELETE FROM music_samples; DELETE FROM music_user_preferences; DELETE FROM music_clock;'); }
}
