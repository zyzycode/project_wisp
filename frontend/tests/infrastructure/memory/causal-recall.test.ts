import { afterEach, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteMemoryStore } from '../../../src/infrastructure/memory/sqlite-store';
import { causalRecallBucket } from '../../../src/domain/character/causal-recall';
import { causalRecallPage } from '../../../src/infrastructure/memory/causal-recall-validation';
import { itemCandidates } from '../../../src/infrastructure/memory/item-validation';
import { LocalMemoryRecall } from '../../../src/application/services/memory-recall';
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

it('measures the approved20-query RU/EN corpus after1000 dialogue pairs and1000 unrelated events, then restart', async () => {
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
  const recall = new LocalMemoryRecall({
    facts: { list: limit => call('listFacts', limit, value => list(value, validation.fact)), upsert: neverWrite, removeByKey: neverWrite },
    history: { getRecent: limit => call('getRecent', limit, value => list(value, validation.message)), appendTurn: neverWrite, closeSession: neverWrite, closeUnfinishedSessions: neverWrite },
    gameReader: { getRecent: limit => call('getRecentEpisodes', limit, value => list(value, validation.episode)) },
    causalRecall: { find: query => call('findCausalLife', query, causalRecallPage) }, itemRecall: { find: tokens => call('findMemoryItems', tokens, itemCandidates) },
    timestamp: () => now, scheduler: { setTimeout, clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) }, isCurrent: () => true, preference: () => undefined, onFailure: code => failures.push(code),
  });
  const cases: readonly [string, string, string | null][] = [
    ['RU1', 'помнишь прерванную игру', 'A'], ['EN1', 'remember when I interrupted the game', 'A'],
    ['RU2', 'тебе помешали поиграть', 'A'], ['EN2', 'remember when you were stopped while playing', 'A'],
    ['RU3', 'игра завершилась по таймауту', 'B'], ['EN3', 'the game timed out', 'B'],
    ['RU4', 'игра потеряла опору', 'C'], ['EN4', 'the game lost its support', 'C'],
    ['RU5', 'мы завершили игру', 'D'], ['EN5', 'we completed a game', 'D'],
    ['RU6', 'ты одна закончила игру', 'E'], ['EN6', 'you finished a game alone', 'E'],
    ['RU7', 'я коснулся тебя', 'F'], ['EN7', 'I touched you', 'F'],
    ['RU8', 'помнишь игру', 'E'], ['EN8', 'remember a game', 'E'],
    ['N1', 'чай на столе', null], ['N2', 'a window title', null], ['N3', 'я не прерывал игру', null], ['N4', 'the game was interrupted and timed out', null],
  ];
  const measurements: { id: string; expected: string | null; selected: string | null; elapsed: number; endToEndMs: number; examined: number; fetched: number }[] = [];
  for (const [id, text, expected] of cases) {
    const started = performance.now(), key = causalRecallBucket(text), page = key ? read(store, key) : null;
    const selected = page?.candidates[0]?.episode.activityRunId ?? page?.candidates[0]?.episode.appRunId ?? null;
    const elapsed = performance.now() - started;
    expect(selected, id).toBe(expected); expect(page?.examined ?? 0).toBeLessThanOrEqual(16); expect(page?.fetched ?? 0).toBeLessThanOrEqual(16); expect(elapsed).toBeLessThanOrEqual(200);
    const contextStarted = performance.now(), context = await recall.recall({ text, excludedMessageIds: [] }, { generation: 0 }), endToEndMs = performance.now() - contextStarted;
    expect(context.ok).toBe(true); expect(endToEndMs).toBeLessThanOrEqual(200);
    if (context.ok) expect(context.value.episodes.filter(event => event.kind === 'causal_event')).toHaveLength(expected ? 1 : 0);
    measurements.push({ id, expected, selected, elapsed, endToEndMs, examined: page?.examined ?? 0, fetched: page?.fetched ?? 0 });
  }
  expect(failures).toEqual([]);
  const times = measurements.map(m => m.elapsed).sort((a, b) => a - b);
  const contextTimes = measurements.map(m => m.endToEndMs).sort((a, b) => a - b);
  console.info('CAUSAL_BASELINE', JSON.stringify({ node: process.version, platform: process.platform, syntheticDialoguePairs: 1000, syntheticNoiseEvents: 1000, precisionAt1: 1, recallAt1: 1, negativeFalsePositives: 0, ruPositive: '8/8', enPositive: '8/8', paraphrasePositive: '2/2', p50Ms: times[9], p95Ms: times[18], maxMs: times[19], contextP50Ms: contextTimes[9], contextP95Ms: contextTimes[18], contextMaxMs: contextTimes[19], maxExamined: Math.max(...measurements.map(m => m.examined)), maxFetched: Math.max(...measurements.map(m => m.fetched)), selections: measurements.map(({ id, expected, selected }) => ({ id, expected, selected })), lexicalMisses: ['RU-round-cut-short', 'EN-round-cut-short'] }));
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
