import type Database from 'better-sqlite3';
import type { SummarySource, SummarySourceSnapshot } from '../../application/ports/summary';
import { fact, record, text, integer, MemoryDataError } from './validation';

export function summarySources(value: unknown): readonly SummarySource[] {
  if (!Array.isArray(value) || value.length < 4 || value.length > 8) throw new MemoryDataError('invalid_data');
  return value.map((item: unknown) => { const r = record(item, ['userMessageId', 'assistantMessageId', 'sessionId', 'revision']); return { userMessageId: text(r.userMessageId), assistantMessageId: text(r.assistantMessageId), sessionId: text(r.sessionId), revision: text(r.revision) }; });
}
export function summarySnapshot(value: unknown): SummarySourceSnapshot {
  const r = record(value, ['pairs', 'facts']);
  if (!Array.isArray(r.pairs) || r.pairs.length > 50 || !Array.isArray(r.facts) || r.facts.length > 100) throw new MemoryDataError('invalid_data');
  return { facts: r.facts.map(fact), pairs: r.pairs.map((item: unknown) => {
    const p = record(item, ['userMessageId', 'assistantMessageId', 'sessionId', 'userText', 'assistantText', 'eligible']);
    if (typeof p.eligible !== 'boolean') throw new MemoryDataError('invalid_data');
    return { userMessageId: text(p.userMessageId), assistantMessageId: text(p.assistantMessageId), sessionId: text(p.sessionId), userText: text(p.userText, 240), assistantText: text(p.assistantText, 2000), eligible: p.eligible };
  }) };
}
/** Worker-only bounded reads. No filtering before the 100-message boundary. */
export function readSummarySources(db: Database.Database, sources: readonly SummarySource[] | null): SummarySourceSnapshot {
  return db.transaction(() => {
    if (integer(record(db.prepare('PRAGMA user_version').get()).user_version) !== 2) return { pairs: [], facts: [] };
    const projection = `SELECT u.sequence AS ordinal, u.id AS userMessageId, a.id AS assistantMessageId, u.conversation_session_id AS sessionId, u.content AS userText, a.content AS assistantText,
      (u.memory_confirmable=1 AND a.memory_confirmable=1 AND NOT EXISTS(SELECT 1 FROM memory_suppressed_pairs s WHERE s.user_message_id=u.id OR s.assistant_message_id=a.id)) AS eligible
      FROM messages u JOIN messages a ON a.sequence=u.sequence+1 AND a.conversation_session_id=u.conversation_session_id AND a.role='assistant' WHERE u.role='user'`;
    const rows = sources === null
      ? db.prepare(`${projection} AND u.sequence >= (SELECT min(sequence) FROM (SELECT sequence FROM messages ORDER BY sequence DESC LIMIT 100)) ORDER BY u.sequence`).all()
      : sources.flatMap(source => { const row = db.prepare(`${projection} AND u.id=? AND a.id=? AND u.conversation_session_id=?`).get(source.userMessageId, source.assistantMessageId, source.sessionId); return row ? [row] : []; });
    const facts = db.prepare(`SELECT id, fact_key AS factKey, fact_value AS factValue, confidence, source_message_id AS sourceMessageId, created_at AS createdAt, updated_at AS updatedAt FROM user_facts
      WHERE NOT EXISTS(SELECT 1 FROM memory_suppressed_pairs s WHERE s.user_message_id=user_facts.source_message_id OR s.assistant_message_id=user_facts.source_message_id) ORDER BY fact_key LIMIT 100`).all();
    let previousOrdinal: number | undefined;
    return summarySnapshot({ pairs: rows.map(value => {
      const { ordinal: rawOrdinal, ...row } = record(value); const ordinal = integer(rawOrdinal, 1);
      const adjacent = sources !== null || previousOrdinal === undefined || ordinal === previousOrdinal + 2;
      previousOrdinal = ordinal;
      return { ...row, eligible: row.eligible === 1 && adjacent };
    }), facts });
  })();
}
