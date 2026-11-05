import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteMemoryStore } from '../../../src/infrastructure/memory/sqlite-store';
const now = '2026-11-05T12:00:00.000Z';
const dirs: string[] = [], stores: SqliteMemoryStore[] = [];
function fixture() { const dir = mkdtempSync(path.join(os.tmpdir(), 'wisp-derived-')); dirs.push(dir); const store = SqliteMemoryStore.open(path.join(dir, 'memory.db'), now); stores.push(store); return store; }
const turn = () => ({ session: { id: 's', appRunId: 'app', startedAt: now, endedAt: null }, user: { id: 'u', conversationSessionId: 's', role: 'user', content: 'Our games?', createdAt: now }, assistant: { id: 'a', conversationSessionId: 's', role: 'assistant', content: 'A tentative reflection', createdAt: now }, memoryConfirmable: false });
const use = { requestId: 'request', userMessageId: 'u', origin: 'reflection' };
const run = (store: SqliteMemoryStore, operation: string, payload: unknown) => store.execute({ id: 1, generation: 0, operation, payload });
afterEach(() => { stores.splice(0).forEach(s => s.close()); dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })); });
it('atomically suppresses derived successful/fallback pairs and enforces exact replay and request/message binding', () => {
  const store = fixture(), bound = { ...turn(), lifeDerivedUse: use };
  expect(run(store, 'appendTurn', bound).ok).toBe(true); expect(run(store, 'appendTurn', bound).ok).toBe(true);
  expect(run(store, 'getRecent', 100)).toEqual({ ok: true, value: [] });
  expect(run(store, 'summaryRecent', null)).toMatchObject({ ok: true, value: { pairs: [{ userMessageId: 'u', assistantMessageId: 'a', eligible: false }] } });
  expect(run(store, 'appendTurn', turn())).toEqual({ ok: false, code: 'conflict' });
  expect(run(store, 'appendTurn', { ...bound, assistant: { ...bound.assistant, content: 'changed' } })).toEqual({ ok: false, code: 'conflict' });
  expect(run(store, 'appendTurn', { ...bound, lifeDerivedUse: { ...use, requestId: 'other' } })).toEqual({ ok: false, code: 'conflict' });
  expect(run(store, 'appendTurn', { ...bound, user: { ...bound.user, id: 'u2' }, assistant: { ...bound.assistant, id: 'a2' }, lifeDerivedUse: { ...use, userMessageId: 'u2' } })).toEqual({ ok: false, code: 'conflict' });
});
it('rejects rebinding an existing unbound pair and mismatched declared user', () => {
  const store = fixture(); expect(run(store, 'appendTurn', turn()).ok).toBe(true);
  expect(run(store, 'appendTurn', { ...turn(), lifeDerivedUse: use })).toEqual({ ok: false, code: 'conflict' });
  const fresh = fixture(); expect(run(fresh, 'appendTurn', { ...turn(), lifeDerivedUse: { ...use, userMessageId: 'wrong' } })).toEqual({ ok: false, code: 'invalid_data' });
  expect(run(fresh, 'getRecent', 100)).toMatchObject({ value: [] });
});
