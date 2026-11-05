import { afterEach, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteMemoryStore } from '../../../src/infrastructure/memory/sqlite-store';
import { itemCandidates } from '../../../src/infrastructure/memory/item-validation';
import type { Operation } from '../../../src/infrastructure/memory/protocol';
const now = '2026-11-01T10:00:00.000Z';
const dirs: string[] = [], stores: SqliteMemoryStore[] = [];
const run = (store: SqliteMemoryStore, operation: Operation, payload: unknown = null, generation = 0) => store.execute({ id: 1, operation, payload, generation });
function fixture() { const dir = mkdtempSync(path.join(os.tmpdir(), 'wisp-item-recall-')); dirs.push(dir); const filename = path.join(dir, 'memory.db'); const store = SqliteMemoryStore.open(filename, now); stores.push(store); return { store, filename }; }
function pair(id: string) { return { memoryConfirmable: true, session: { id: 's', appRunId: 'app', startedAt: now, endedAt: null }, user: { id: `u${id}`, conversationSessionId: 's', role: 'user', content: `Synthetic ${id}`, createdAt: now }, assistant: { id: `a${id}`, conversationSessionId: 's', role: 'assistant', content: 'Synthetic acknowledgement', createdAt: now } }; }
const content = (label = 'Диплом', text = 'Диплом робототехнике') => ({ category: 'important_event', label, text, occurredOn: '2026-10-10' });
function confirm(id: string, label?: string, text?: string) { return { kind: 'confirm', commandId: `c${id}`, itemId: id, expectedRevision: 0, confirmed: true, content: content(label, text), source: { userMessageId: `u${id}`, assistantMessageId: `a${id}` }, confirmedAt: now }; }
function find(store: SqliteMemoryStore, tokens: readonly string[], generation: number) { const result = run(store, 'findMemoryItems', tokens, generation); if (!result.ok) throw new Error(result.code); return itemCandidates(result.value); }
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

it('uses indexed current card revisions after long dialogue growth and filters withdrawn/deleted sources', () => {
  const f = fixture();
  const cards = [['1', 'Диплом', 'Диплом робототехнике', 'робототехнике'], ['2', 'Чайный капитан', 'Шутка о чае', 'чайный'], ['3', 'Первый марафон', 'Марафон закончен', 'марафон'], ['4', 'Поездка на Байкал', 'Байкал', 'байкал'], ['5', 'Картофельный адмирал', 'Шутка про картофель', 'картофельный']] as const;
  for (const [i, [id, label, text]] of cards.entries()) { run(f.store, 'appendTurn', pair(id), i); const command = confirm(id, label, text); expect(run(f.store, 'mutateMemoryItem', { ...command, content: { ...command.content, category: id === '2' || id === '5' ? 'shared_joke' : 'important_event' } }, i + 1).ok).toBe(true); }
  for (let i = 0; i < 1000; i++) expect(run(f.store, 'appendTurn', pair(`noise${i}`), 5).ok).toBe(true);
  f.store.close(); const store = SqliteMemoryStore.open(f.filename, now); stores.push(store);
  expect(find(store, ['диплом', 'робототехнике'], 0).candidates[0]?.item).toMatchObject({ id: '1', revision: 1 });
  for (const [id, , , token] of cards) { const page = find(store, [token], 0); expect(page.candidates[0]?.item.id).toBe(id); expect(page.examined).toBeLessThanOrEqual(96); expect(page.fetched).toBeLessThanOrEqual(96); }
  expect(run(store, 'mutateMemoryItem', { ...confirm('1'), kind: 'update', commandId: 'update', expectedRevision: 1, content: content('Диплом', 'Диплом математике') }, 1).ok).toBe(true);
  expect(find(store, ['робототехнике'], 1).candidates).toEqual([]); expect(find(store, ['математике'], 1).candidates[0]?.item.revision).toBe(2);
  expect(run(store, 'mutateMemoryItem', { kind: 'withdraw', commandId: 'withdraw', itemId: '1', expectedRevision: 2 }, 2).ok).toBe(true);
  expect(find(store, ['диплом'], 2).candidates).toEqual([]);
  expect(run(store, 'mutateMemoryItem', { kind: 'delete', commandId: 'delete', itemId: '1', expectedRevision: 3 }, 3).ok).toBe(true);
  expect(find(store, ['диплом'], 3).candidates).toEqual([]);
}, 15000);
it('orders revisions by acknowledged confirmation order, preserves replay order and caps12 postings per token', () => {
  const f = fixture();
  for (let i = 0; i < 20; i++) { run(f.store, 'appendTurn', pair(String(i)), i); expect(run(f.store, 'mutateMemoryItem', confirm(String(i)), i + 1).ok).toBe(true); }
  expect(find(f.store, ['диплом'], 20)).toMatchObject({ examined: 12, fetched: 12 });
  const update = { ...confirm('0'), kind: 'update', commandId: 'update0', expectedRevision: 1 };
  expect(run(f.store, 'mutateMemoryItem', update, 21).ok).toBe(true);
  expect(find(f.store, ['диплом'], 21).candidates[0]?.item.id).toBe('0');
  expect(run(f.store, 'mutateMemoryItem', update, 22).ok).toBe(true);
  expect(find(f.store, ['диплом'], 22).candidates[0]?.item.id).toBe('0');
  expect(run(f.store, 'findMemoryItems', ['Диплом'], 22)).toEqual({ ok: false, code: 'invalid_data' });
});
it('rebuilds a lost derived item index without deleting the confirmed card or sending partial results', () => {
  const f = fixture(); run(f.store, 'appendTurn', pair('1')); run(f.store, 'mutateMemoryItem', confirm('1'), 1); f.store.close();
  const db = new Database(f.filename); db.exec('DROP TABLE memory_item_terms'); db.close();
  const store = SqliteMemoryStore.open(f.filename, now); stores.push(store);
  expect(find(store, ['диплом'], 0)).toMatchObject({ coverage: 'index_building', candidates: [] });
  expect(find(store, ['диплом'], 0).candidates[0]?.item.id).toBe('1');
});
