import { afterEach, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteMemoryStore } from '../../../src/infrastructure/memory/sqlite-store';
import { causalRecallBucket } from '../../../src/domain/character/causal-recall';
import { CAUSAL_RECALL_CORPUS } from './causal-recall-corpus';
import { causalRecallPage } from '../../../src/infrastructure/memory/causal-recall-validation';
import { itemCandidates } from '../../../src/infrastructure/memory/item-validation';
import { LocalMemoryRecall, memoryTextLength } from '../../../src/application/services/memory-recall';
import * as validation from '../../../src/infrastructure/memory/validation';
import type { MemoryResult } from '../../../src/application/ports/memory-repository.interface';
import type { CausalLifeEpisode } from '../../../src/application/ports/causal-life.interface';
import type { Operation } from '../../../src/infrastructure/memory/protocol';

const then = '2026-11-01T10:00:00.000Z', now = '2026-11-05T10:00:00.000Z';
const dirs: string[] = [], stores: SqliteMemoryStore[] = [];
function fixture() { const dir = mkdtempSync(path.join(os.tmpdir(), 'wisp-causal-recall-')); dirs.push(dir); const filename = path.join(dir, 'memory.db'); const store = SqliteMemoryStore.open(filename, now); stores.push(store); return { store, filename }; }
function run(store: SqliteMemoryStore, operation: Operation, payload: unknown = null, generation = 0) { return store.execute({ id: 1, operation, payload, generation }); }
function read(store: SqliteMemoryStore, key: string, generation = 0) { const result = run(store, 'findCausalLife', { key, before: now }, generation); if (!result.ok) throw new Error(result.code); return causalRecallPage(result.value); }
const contact = (appRunId: string, sequence: number): CausalLifeEpisode => ({ appRunId, sequence, revision: 1, occurredAt: then, source: 'user', triggerSequence: null, activityRunId: null, activity: null, outcome: null, terminalReason: null, cause: 'contact', executedMs: 0, participation: 'none' });
const event = (id: string, sequence: number, cause: 'user_interrupted' | 'timeout' | 'environment_lost' | 'completed', solitary = false): CausalLifeEpisode => ({ ...contact('history', sequence), activityRunId: id, activity: 'cursor_game', outcome: cause === 'completed' ? 'completed' : cause === 'timeout' ? 'failed' : 'cancelled', source: cause === 'completed' ? 'autonomy' : cause === 'user_interrupted' ? 'user' : 'system', triggerSequence: cause === 'user_interrupted' ? 1 : null, terminalReason: cause === 'completed' ? null : cause === 'user_interrupted' ? 'user_interaction' : cause === 'timeout' ? 'step_timeout' : 'environment_invalidated', cause, executedMs: 1500, participation: solitary ? 'solitary' : 'user_engaged' });
function list<T>(value: unknown, parse: (value: unknown) => T): readonly T[] { if (!Array.isArray(value)) throw new Error('Expected rows'); return value.map(parse); }
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

it('measures the approved40-query RU/EN corpus after1000 dialogue pairs and1000 unrelated events, then restart', async () => {
  const f = fixture();
  const old = { ...event('old-A', 2, 'user_interrupted'), appRunId: 'older' };
  for (const e of [old, event('A', 2, 'user_interrupted'), event('B', 3, 'timeout'), event('C', 4, 'environment_lost'), event('D', 5, 'completed'), event('E', 6, 'completed', true)]) expect(run(f.store, 'appendCausalLife', e).ok).toBe(true);
  for (let i = 0; i < 1000; i++) {
    expect(run(f.store, 'appendCausalLife', contact('noise', i + 1)).ok).toBe(true);
    expect(run(f.store, 'appendTurn', { memoryConfirmable: true, session: { id: 's', appRunId: 'dialogue', startedAt: then, endedAt: null }, user: { id: `u${i}`, conversationSessionId: 's', role: 'user', content: `Synthetic unrelated ${i}`, createdAt: then }, assistant: { id: `a${i}`, conversationSessionId: 's', role: 'assistant', content: 'Synthetic answer', createdAt: then } }).ok).toBe(true);
  }
  expect(run(f.store, 'appendCausalLife', contact('F', 1)).ok).toBe(true);
  f.store.close(); const store = SqliteMemoryStore.open(f.filename, now); stores.push(store);
  const call = async <T>(operation: Operation, payload: unknown, parse: (value: unknown) => T): Promise<MemoryResult<T>> => {
    const result = run(store, operation, payload); return result.ok ? { ok: true, value: parse(result.value) } : result;
  };
  const neverWrite = async (): Promise<never> => { throw new Error('Recall must not write experience'); };
  const failures: string[] = [];
  let contextSource: string | null = null, contextBucket: string | null = null, causalCalls = 0;
  const recall = new LocalMemoryRecall({
    facts: { list: limit => call('listFacts', limit, value => list(value, validation.fact)), upsert: neverWrite, removeByKey: neverWrite },
    history: { getRecent: limit => call('getRecent', limit, value => list(value, validation.message)), appendTurn: neverWrite, closeSession: neverWrite, closeUnfinishedSessions: neverWrite },
    gameReader: { getRecent: limit => call('getRecentEpisodes', limit, value => list(value, validation.episode)) },
    causalRecall: { find: async query => {
      causalCalls++; contextBucket = query.key; const result = await call('findCausalLife', query, causalRecallPage);
      const found = result.ok ? result.value.candidates[0]?.episode : undefined;
      contextSource = found?.activityRunId ?? found?.appRunId ?? null; return result;
    } }, itemRecall: { find: tokens => call('findMemoryItems', tokens, itemCandidates) },
    timestamp: () => now, scheduler: { setTimeout, clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) }, isCurrent: () => true, preference: () => undefined, onFailure: code => failures.push(code),
  });
  const measurements: { id: string; expected: string | null; selected: string | null; bucket: string | null; contextMatches: boolean; baseline: string | null; queryMs: number; elapsed: number; endToEndMs: number; examined: number; fetched: number }[] = [];
  for (const { id, text, expected } of CAUSAL_RECALL_CORPUS) {
    const started = performance.now(), key = causalRecallBucket(text), queryMs = performance.now() - started;
    const page = key ? read(store, key) : null;
    const selected = page?.candidates[0]?.episode.activityRunId ?? page?.candidates[0]?.episode.appRunId ?? null;
    const elapsed = performance.now() - started;
    expect(page?.examined ?? 0).toBeLessThanOrEqual(16); expect(page?.fetched ?? 0).toBeLessThanOrEqual(16); expect(elapsed).toBeLessThanOrEqual(200);
    contextSource = null; contextBucket = null; causalCalls = 0;
    const contextStarted = performance.now(), context = await recall.recall({ text, excludedMessageIds: [] }, { generation: 0 }), endToEndMs = performance.now() - contextStarted;
    expect(context.ok).toBe(true); expect(endToEndMs).toBeLessThanOrEqual(200);
    const causal = context.ok ? context.value.episodes.filter(event => event.kind === 'causal_event') : [];
    const contextMatches = expected ? causal.length === 1 && contextSource === expected && contextBucket === key && causal[0]?.cause === page?.candidates[0]?.episode.cause : causal.length === 0 && contextSource === null;
    expect(causalCalls).toBe(key ? 1 : 0);
    if (context.ok) { expect(context.value.episodes.length).toBeLessThanOrEqual(2); expect(memoryTextLength(context.value)).toBeLessThanOrEqual(2400); expect(Buffer.byteLength(JSON.stringify(context.value))).toBeLessThanOrEqual(32768); }
    const baseline = CAUSAL_RECALL_CORPUS.find(row => row.id === id)!.baselineSelected;
    measurements.push({ id, expected, selected, bucket: key, contextMatches, baseline, queryMs, elapsed, endToEndMs, examined: page?.examined ?? 0, fetched: page?.fetched ?? 0 });
  }
  expect(failures).toEqual([]);
  const queryTimes = measurements.map(m => m.queryMs).sort((a, b) => a - b);
  const times = measurements.map(m => m.elapsed).sort((a, b) => a - b);
  const contextTimes = measurements.map(m => m.endToEndMs).sort((a, b) => a - b);
  const metrics = {
    queryP50Ms: queryTimes[19], queryP95Ms: queryTimes[37], queryMaxMs: queryTimes[39],
    queryAndIndexP50Ms: times[19], queryAndIndexP95Ms: times[37], queryAndIndexMaxMs: times[39],
    contextP50Ms: contextTimes[19], contextP95Ms: contextTimes[37], contextMaxMs: contextTimes[39],
    maxExamined: Math.max(...measurements.map(row => row.examined)), maxFetched: Math.max(...measurements.map(row => row.fetched)),
    improved: measurements.filter(row => row.baseline !== row.expected && row.selected === row.expected && row.contextMatches).map(row => row.id),
    worsened: measurements.filter(row => row.baseline === row.expected && (row.selected !== row.expected || !row.contextMatches)).map(row => row.id),
    selections: measurements.map(({ id, expected, selected, bucket, contextMatches }) => ({ id, expected, selected, bucket, contextMatches })),
  };
  writeFileSync(path.join(os.tmpdir(), 'wisp-174-metrics.json'), JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch, baselineSource: '615ade1', syntheticDialoguePairs: 1000, syntheticNoiseEvents: 1000, ...metrics }, null, 2));
  expect(measurements.filter(row => row.selected !== row.expected || !row.contextMatches).map(row => row.id)).toEqual([]);
  expect(causalRecallBucket('remember when our round was cut short')).toBeNull();
  expect(causalRecallBucket('вспомни как наше развлечение оборвалось')).toBeNull();
}, 15000);

it('bounds candidate work, excludes future/current/deleted sources and rejects stale generations after reset', () => {
  const f = fixture();
  for (let i = 2; i < 22; i++) expect(run(f.store, 'appendCausalLife', event(`A${i}`, i, 'user_interrupted')).ok).toBe(true);
  const page = read(f.store, 'game.user_interrupted'); expect(page.examined).toBe(16); expect(page.fetched).toBe(16); expect(page.candidates[0]?.source.sequence).toBe(21);
  const excluded = run(f.store, 'findCausalLife', { key: 'game.user_interrupted', before: now, exclude: { appRunId: 'history', sequence: 21, revision: 1 } });
  expect(excluded.ok && causalRecallPage(excluded.value).candidates[0]?.source.sequence).toBe(20);
  const db = new Database(f.filename); db.pragma('foreign_keys=ON'); db.prepare('DELETE FROM causal_life_episodes').run(); db.close();
  expect(read(f.store, 'game.user_interrupted').candidates).toEqual([]);
  expect(run(f.store, 'appendCausalLife', { ...event('future', 99, 'completed'), occurredAt: '2026-11-06T00:00:00.000Z' }).ok).toBe(true);
  expect(read(f.store, 'game.any').candidates).toEqual([]);
  expect(run(f.store, 'clear', null, 1).ok).toBe(true); expect(run(f.store, 'findCausalLife', { key: 'game.any', before: now })).toEqual({ ok: false, code: 'stale' });
  expect(read(f.store, 'game.any', 1).candidates).toEqual([]);
});

it('rebuilds lost derived indexes in bounded64-row batches without losing canonical sources', () => {
  const f = fixture(); for (let i = 1; i <= 130; i++) run(f.store, 'appendCausalLife', contact('history', i));
  f.store.close(); const db = new Database(f.filename); db.exec('DROP TABLE causal_recall_postings; DROP TABLE causal_recall_build;'); db.close();
  const store = SqliteMemoryStore.open(f.filename, now); stores.push(store);
  expect(read(store, 'contact')).toMatchObject({ coverage: 'index_building', candidates: [] });
  expect(read(store, 'contact').coverage).toBe('index_building');
  expect(read(store, 'contact').coverage).toBe('index_building');
  const complete = read(store, 'contact'); expect(complete.coverage).toBe('complete'); expect(complete.candidates[0]?.source.sequence).toBe(130);
});
