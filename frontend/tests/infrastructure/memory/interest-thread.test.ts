import { schema3 } from './schema-fixture';
import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteMemoryStore } from '../../../src/infrastructure/memory/sqlite-store';
import { initializeSchema } from '../../../src/infrastructure/memory/schema';
import type { Operation } from '../../../src/infrastructure/memory/protocol';

const now = '2026-09-18T10:00:00.000Z';
const eligible = '2026-09-19T10:00:00.000Z';
const expired = '2026-09-25T10:00:00.000Z';
const dirs: string[] = [], stores: SqliteMemoryStore[] = [];
function fixture() { const dir = mkdtempSync(path.join(os.tmpdir(), 'wisp-topic-')); dirs.push(dir); const filename = path.join(dir, 'memory.db'); const store = SqliteMemoryStore.open(filename, now); stores.push(store); return { store, filename }; }
function run(store: SqliteMemoryStore, operation: Operation, payload: unknown = null, generation = 0) { return store.execute({ id: 1, operation, payload, generation }); }
function pair(suffix = '', time = now) { return { memoryConfirmable: true, session: { id: 's', appRunId: 'app', startedAt: now, endedAt: null }, user: { id: `u${suffix}`, conversationSessionId: 's', role: 'user', content: 'сегодня собеседование', createdAt: time }, assistant: { id: `a${suffix}`, conversationSessionId: 's', role: 'assistant', content: 'Буду рядом', createdAt: time } }; }
function confirm(suffix = '') { return { kind: 'confirm', commandId: `confirm${suffix}`, threadId: `topic${suffix}`, expected: null, confirmed: true, source: { userMessageId: `u${suffix}`, assistantMessageId: `a${suffix}` }, text: 'собеседование', confirmedAt: now }; }
function ref(revision = 1, threadId = 'topic') { return { threadId, revision }; }
function reserve(revision = 1, time = eligible) { return { expected: ref(revision), requestId: 'request', userMessageId: 'uoffer', now: time }; }
function setup() { const f = fixture(); expect(run(f.store, 'appendTurn', pair()).ok).toBe(true); expect(run(f.store, 'mutateInterestThread', confirm(), 1)).toMatchObject({ ok: true, value: { ref: ref(), outcome: 'unanswered' } }); return f; }
afterEach(() => { for (const s of stores.splice(0)) s.close(); for (const d of dirs.splice(0)) rmSync(d, { force: true, recursive: true }); });

describe('interest thread worker persistence', () => {
  it('requires committed successful adjacent source and exact quote, retaining barrier after rejection', () => {
    const f = fixture(); expect(run(f.store, 'mutateInterestThread', confirm(), 1)).toEqual({ ok: false, code: 'invalid_data' });
    expect(run(f.store, 'appendTurn', pair())).toEqual({ ok: false, code: 'stale' });
    run(f.store, 'appendTurn', pair(), 1);
    expect(run(f.store, 'mutateInterestThread', { ...confirm(), text: 'несуществующая цитата' }, 2)).toEqual({ ok: false, code: 'invalid_data' });
    expect(run(f.store, 'mutateInterestThread', { ...confirm(), source: { userMessageId: 'a', assistantMessageId: 'u' } }, 3)).toEqual({ ok: false, code: 'invalid_data' });
    expect(run(f.store, 'mutateInterestThread', confirm(), 4).ok).toBe(true);
    expect(run(f.store, 'getRecent', 100, 4)).toEqual({ ok: true, value: [] });
    expect(run(f.store, 'summaryRecent', null, 4)).toMatchObject({ ok: true, value: { pairs: [{ eligible: false }] } });
  });
  it('pure reads retain expired text until explicit close barrier; identical mutation replay is historical', () => {
    const f = setup(); expect(run(f.store, 'claimInterestThread', reserve(1, expired), 1)).toEqual({ ok: true, value: null });
    expect(run(f.store, 'readInterestThread', null, 1)).toMatchObject({ ok: true, value: { sourceValid: true, thread: { state: 'unanswered', text: 'собеседование' } } });
    expect(run(f.store, 'mutateInterestThread', { kind: 'close', commandId: 'close', expected: ref(), reason: 'expired' }, 2)).toMatchObject({ ok: true, value: { ref: ref(2), outcome: 'closed' } });
    expect(run(f.store, 'mutateInterestThread', confirm(), 3)).toMatchObject({ ok: true, value: { ref: ref(), outcome: 'unanswered' } });
    expect(run(f.store, 'readInterestThread', null, 3)).toMatchObject({ ok: true, value: { thread: { state: 'closed', text: null } } });
    expect(run(f.store, 'mutateInterestThread', { ...confirm(), text: 'сегодня' }, 4)).toEqual({ ok: false, code: 'conflict' });
  });
  it('claims once at exactly 24h, survives lost acknowledgment/restart, and stores one completed offer', () => {
    const f = setup(); expect(run(f.store, 'claimInterestThread', reserve(1, now), 1)).toEqual({ ok: true, value: null });
    expect(run(f.store, 'claimInterestThread', reserve(), 1)).toMatchObject({ ok: true, value: { use: { ref: ref(2), requestId: 'request' }, generation: 1 } });
    expect(run(f.store, 'claimInterestThread', reserve(2), 1)).toEqual({ ok: true, value: null });
    const offered = { ...pair('offer', eligible), interestThread: { ref: ref(2), requestId: 'request', userMessageId: 'uoffer', mode: 'follow_up' } };
    expect(run(f.store, 'appendTurn', offered, 1)).toEqual({ ok: true, value: undefined });
    expect(run(f.store, 'appendTurn', { ...offered, assistant: { ...offered.assistant, id: 'other' } }, 1)).toEqual({ ok: false, code: 'conflict' });
    f.store.close(); const reopened = SqliteMemoryStore.open(f.filename, eligible); stores.push(reopened);
    expect(run(reopened, 'claimInterestThread', reserve(2))).toEqual({ ok: true, value: null });
    expect(run(reopened, 'appendTurn', offered)).toEqual({ ok: true, value: undefined });
  });
  it('requires committed reservation identity and rejects retroactive binding', () => {
    const f = setup(); const bound = { ...pair('offer', eligible), interestThread: { ref: ref(), requestId: 'request', userMessageId: 'uoffer', mode: 'follow_up' } };
    expect(run(f.store, 'appendTurn', bound, 1)).toEqual({ ok: false, code: 'conflict' });
    expect(run(f.store, 'appendTurn', pair('offer', eligible), 1).ok).toBe(true);
    expect(run(f.store, 'appendTurn', { ...bound, interestThread: { ...bound.interestThread, mode: 'reply' } }, 1)).toEqual({ ok: false, code: 'conflict' });
  });
  it('atomically answers and suppresses explicit successful reply, rejecting another old-ref pair', () => {
    const f = setup(); expect(run(f.store, 'captureInterestThreadReply', reserve(), 1)).toMatchObject({ ok: true, value: { use: { ref: ref(), mode: 'reply' } } });
    const answer = { ...pair('offer', eligible), interestThread: { ref: ref(), requestId: 'request', userMessageId: 'uoffer', mode: 'reply' } };
    expect(run(f.store, 'appendTurn', answer, 1)).toEqual({ ok: true, value: undefined });
    expect(run(f.store, 'readInterestThread', null, 1)).toMatchObject({ ok: true, value: { thread: { ref: ref(2), state: 'answered', text: null, answerSource: { userMessageId: 'uoffer', assistantMessageId: 'aoffer' } } } });
    expect(run(f.store, 'appendTurn', { ...pair('second', eligible), interestThread: { ...answer.interestThread, requestId: 'second', userMessageId: 'usecond' } }, 1)).toEqual({ ok: false, code: 'conflict' });
    expect(run(f.store, 'getRecent', 100, 1)).toEqual({ ok: true, value: [] });
    expect(run(f.store, 'summaryRecent', null, 1)).toMatchObject({ ok: true, value: { pairs: [{ eligible: false }, { eligible: false }] } });
  });
  it('fallback reply suppresses pair without answering, and free reply does not answer', () => {
    const f = setup(); expect(run(f.store, 'appendTurn', pair('free', eligible), 1).ok).toBe(true);
    const answer = { ...pair('offer', eligible), memoryConfirmable: false, interestThread: { ref: ref(), requestId: 'request', userMessageId: 'uoffer', mode: 'reply' } };
    expect(run(f.store, 'appendTurn', answer, 1).ok).toBe(true);
    expect(run(f.store, 'readInterestThread', null, 1)).toMatchObject({ ok: true, value: { thread: { state: 'unanswered', ref: ref() } } });
    expect(run(f.store, 'getRecent', 100, 1)).toEqual({ ok: true, value: [pair('free', eligible).user, pair('free', eligible).assistant] });
  });
  it('preserves reverse receipt checks after delete, blocking unbound and altered replays', () => {
    const f = setup(); const answer = { ...pair('offer', eligible), interestThread: { ref: ref(), requestId: 'request', userMessageId: 'uoffer', mode: 'reply' } };
    expect(run(f.store, 'appendTurn', answer, 1).ok).toBe(true);
    expect(run(f.store, 'mutateInterestThread', { kind: 'delete', commandId: 'delete', expected: ref(2) }, 2).ok).toBe(true);
    expect(run(f.store, 'appendTurn', answer, 2).ok).toBe(true);
    expect(run(f.store, 'appendTurn', pair('offer', eligible), 2)).toEqual({ ok: false, code: 'conflict' });
    expect(run(f.store, 'appendTurn', { ...answer, user: { ...answer.user, content: 'changed' } }, 2)).toEqual({ ok: false, code: 'conflict' });
    expect(run(f.store, 'mutateInterestThread', { ...confirm(), commandId: 'new', threadId: 'new' }, 3)).toEqual({ ok: false, code: 'conflict' });
    expect(run(f.store, 'clear', null, 4).ok).toBe(true);
    const db = new Database(f.filename); expect(db.prepare('SELECT * FROM interest_thread_receipts').all()).toEqual([]); expect(db.prepare('SELECT * FROM memory_suppressed_pairs').all()).toEqual([]); db.close();
  });
  it('rolls back answer, both messages and suppression on receipt failure', () => {
    const f = setup(); const db = new Database(f.filename); db.exec("CREATE TRIGGER reject_turn BEFORE INSERT ON interest_thread_receipts WHEN NEW.kind='turn' BEGIN SELECT RAISE(ABORT,'test'); END;");
    const answer = { ...pair('offer', eligible), interestThread: { ref: ref(), requestId: 'request', userMessageId: 'uoffer', mode: 'reply' } };
    expect(run(f.store, 'appendTurn', answer, 1)).toEqual({ ok: false, code: 'conflict' });
    expect(db.prepare('SELECT count(*) n FROM messages').get()).toEqual({ n: 2 });
    expect(db.prepare('SELECT count(*) n FROM memory_suppressed_pairs').get()).toEqual({ n: 1 });
    expect(run(f.store, 'readInterestThread', null, 1)).toMatchObject({ ok: true, value: { thread: { state: 'unanswered' } } }); db.close();
  });
  it('reports changed source without writes and rejects claim/append against it', () => {
    const f = setup(); const db = new Database(f.filename); db.prepare("UPDATE messages SET content='changed' WHERE role='user'").run();
    expect(run(f.store, 'readInterestThread', null, 1)).toMatchObject({ ok: true, value: { sourceValid: false, thread: { state: 'unanswered', text: 'собеседование' } } });
    expect(run(f.store, 'claimInterestThread', reserve(), 1)).toEqual({ ok: true, value: null }); db.close();
  });
  it('rolls migration3 back to schema2 without changing transcript or snapshots', () => {
    const f = setup(); f.store.close(); const db = new Database(f.filename);
    schema3(db);
    db.exec("DROP TABLE interest_thread; DROP TABLE interest_thread_receipts; DELETE FROM schema_migrations WHERE version=3; PRAGMA user_version=2; CREATE TRIGGER reject_v3 BEFORE INSERT ON schema_migrations WHEN NEW.version=3 BEGIN SELECT RAISE(ABORT,'test'); END;");
    const before = db.prepare('SELECT * FROM messages').all(); expect(() => initializeSchema(db, now)).toThrow();
    expect(db.pragma('user_version', { simple: true })).toBe(2); expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'interest_%'").all()).toEqual([]); expect(db.prepare('SELECT * FROM messages').all()).toEqual(before);
    db.exec('DROP TRIGGER reject_v3'); initializeSchema(db, now); expect(db.pragma('user_version', { simple: true })).toBe(5); db.close();
  });
  it('replaces only by explicit CAS with a fresh pair and retains earlier suppression', () => {
    const f = setup(); expect(run(f.store, 'appendTurn', pair('new'), 1).ok).toBe(true);
    expect(run(f.store, 'mutateInterestThread', confirm('new'), 2)).toEqual({ ok: false, code: 'conflict' });
    expect(run(f.store, 'mutateInterestThread', { ...confirm('new'), expected: ref() }, 3)).toMatchObject({ ok: true, value: { ref: ref(1, 'topicnew') } });
    expect(run(f.store, 'getRecent', 100, 3)).toEqual({ ok: true, value: [] });
    expect(run(f.store, 'claimInterestThread', reserve(), 3)).toEqual({ ok: true, value: null });
  });
  it('rejects card-owned, unsuccessful and nonadjacent sources', () => {
    const f = fixture(); run(f.store, 'appendTurn', { ...pair(), memoryConfirmable: false });
    expect(run(f.store, 'mutateInterestThread', confirm(), 1)).toEqual({ ok: false, code: 'invalid_data' });
    run(f.store, 'appendTurn', pair('new'), 1);
    expect(run(f.store, 'mutateInterestThread', { ...confirm(), source: { userMessageId: 'u', assistantMessageId: 'anew' } }, 2)).toEqual({ ok: false, code: 'invalid_data' });
    expect(run(f.store, 'mutateMemoryItem', { kind: 'confirm', commandId: 'card', itemId: 'card', expectedRevision: 0, confirmed: true, content: { category: 'important_event', label: 'Event', text: 'Confirmed', occurredOn: null }, source: { userMessageId: 'unew', assistantMessageId: 'anew' }, confirmedAt: now }, 3).ok).toBe(true);
    expect(run(f.store, 'mutateInterestThread', confirm('new'), 4)).toEqual({ ok: false, code: 'conflict' });
  });
  it('defensively closes an imported shared source in the same card deletion transaction', () => {
    const f = setup(); const db = new Database(f.filename);
    // Sharing is unreachable through ordinary confirmation; simulate imported/future state.
    db.prepare("INSERT INTO memory_items (id,revision,status,category,label,text,confirmed_at,command_id,source_user_id,source_assistant_id) VALUES ('card',1,'active','important_event','Imported','Imported',?,'import','u','a')").run(now);
    db.exec("INSERT INTO memory_item_sources VALUES ('card','u','a'); CREATE TRIGGER reject_card_delete BEFORE DELETE ON memory_items BEGIN SELECT RAISE(ABORT,'test'); END;");
    const command = { kind: 'delete', commandId: 'delete-card', itemId: 'card', expectedRevision: 1 };
    expect(run(f.store, 'mutateMemoryItem', command, 2)).toEqual({ ok: false, code: 'conflict' });
    expect(run(f.store, 'readInterestThread', null, 2)).toMatchObject({ ok: true, value: { thread: { state: 'unanswered', ref: ref() } } });
    db.exec('DROP TRIGGER reject_card_delete');
    expect(run(f.store, 'mutateMemoryItem', command, 3).ok).toBe(true);
    expect(run(f.store, 'readInterestThread', null, 3)).toMatchObject({ ok: true, value: { thread: { state: 'closed', reason: 'source_changed', text: null, ref: ref(2) } } }); db.close();
  });
  it('rolls back full reset with singleton, receipts and suppression while old callbacks stay stale', () => {
    const f = setup(); const db = new Database(f.filename); db.exec("CREATE TRIGGER reject_reset BEFORE DELETE ON messages BEGIN SELECT RAISE(ABORT,'test'); END;");
    expect(run(f.store, 'clear', null, 2)).toEqual({ ok: false, code: 'conflict' });
    expect(run(f.store, 'readInterestThread', null, 2)).toMatchObject({ ok: true, value: { thread: { state: 'unanswered' } } });
    expect(db.prepare('SELECT count(*) n FROM interest_thread_receipts').get()).toEqual({ n: 1 });
    expect(db.prepare('SELECT count(*) n FROM memory_suppressed_pairs').get()).toEqual({ n: 1 });
    expect(run(f.store, 'claimInterestThread', reserve(), 1)).toEqual({ ok: false, code: 'stale' }); db.close();
  });
  it.each(['x'.repeat(161), '\ud800'])('rejects malformed topic text %j before persistence', value => {
    const f = fixture(); run(f.store, 'appendTurn', pair());
    expect(run(f.store, 'mutateInterestThread', { ...confirm(), text: value }, 1)).toEqual({ ok: false, code: 'invalid_data' });
    expect(run(f.store, 'readInterestThread')).toEqual({ ok: true, value: { thread: null, sourceValid: false } });
  });

  it.each(['My name is Alex', 'Мне нравятся твои прогулки', 'Temporarily be a pirate'])('worker rejects registry/command sources directly: %s', content => {
    const f = fixture(); const turn = pair(); turn.user.content = content;
    expect(run(f.store, 'appendTurn', turn).ok).toBe(true);
    expect(run(f.store, 'mutateInterestThread', { ...confirm(), text: content }, 1)).toEqual({ ok: false, code: 'invalid_data' });
    expect(run(f.store, 'readInterestThread', null, 1)).toEqual({ ok: true, value: { thread: null, sourceValid: false } });
  });
  it('rejects a confirmation whose retention interval exceeds supported UTC dates', () => {
    const f = fixture(); run(f.store, 'appendTurn', pair());
    expect(run(f.store, 'mutateInterestThread', { ...confirm(), confirmedAt: '9999-12-31T00:00:00.000Z' }, 1)).toEqual({ ok: false, code: 'invalid_data' });
    expect(run(f.store, 'readInterestThread', null, 1)).toEqual({ ok: true, value: { thread: null, sourceValid: false } });
  });

  it('rejects a C1 quote even when verbatim source contains it', () => {
    const f = fixture(); const content = 'interview\u0085today', turn = pair(); turn.user.content = content;
    expect(run(f.store, 'appendTurn', turn).ok).toBe(true);
    expect(run(f.store, 'mutateInterestThread', { ...confirm(), text: content }, 1)).toEqual({ ok: false, code: 'invalid_data' });
  });

});
