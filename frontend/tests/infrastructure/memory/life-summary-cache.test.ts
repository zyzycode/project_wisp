import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FileSummaryCache, parseSummaryCache } from '../../../src/infrastructure/memory/summary-cache';
const folders: string[] = [];
const hash = 'a'.repeat(64);
const source = (i: number) => ({ userMessageId: `u${i}`, assistantMessageId: `a${i}`, sessionId: 's', revision: hash });
const old = () => ({ formatVersion: 1, entry: { text: 'Old summary', sources: Array.from({ length: 4 }, (_, i) => source(i)), sourceDigest: hash, factsDigest: 'b'.repeat(64), locale: 'en', generatorVersion: 1 }, receipt: { commandId: 'old-command', requestId: 'old-request', sourceDigest: hash, admittedAt: 200000000, generatorVersion: 1 } });
afterEach(async () => { await Promise.all(folders.splice(0).map(folder => rm(folder, { recursive: true, force: true }))); });
it('strictly migrates format1 without changing hashes, locale, generatorVersion or the shared admission receipt', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'wisp-life-cache-')); folders.push(folder); const file = path.join(folder, 'summary-cache.json');
  const legacy = old(); await writeFile(file, JSON.stringify(legacy)); const cache = new FileSummaryCache(file, () => 1); const read = await cache.read(); if (!read.ok) throw new Error('Read failed');
  expect(read.value).toEqual({ formatVersion: 2, entry: { ...legacy.entry, mode: 'dialogue_pairs' }, receipt: { ...legacy.receipt, mode: 'dialogue_pairs' } });
  expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(legacy);
  expect((await cache.write(read.value, cache.invalidate())).ok).toBe(true); expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(read.value);
  await cache.clear(false); expect(await cache.read()).toEqual({ ok: true, value: { formatVersion: 2, entry: null, receipt: read.value.receipt } }); cache.dispose();
});
it('rejects mixed-mode receipts, future formats and duplicate/malformed exact life sources', () => {
  const valid = { formatVersion: 2, entry: { mode: 'life_events', text: 'Events', sources: Array.from({ length: 4 }, (_, i) => ({ appRunId: 'app', sequence: i+1, revision: 1, contentDigest: hash })), sourceDigest: hash, fromDateUTC: '2026-10-23', throughDateUTC: '2026-11-05', locale: 'en', generatorVersion: 2 }, receipt: { ...old().receipt, mode: 'life_events', generatorVersion: 2 } };
  expect(parseSummaryCache(valid)).toEqual(valid);
  for (const value of [{ ...valid, formatVersion: 3 }, { ...valid, receipt: { ...old().receipt, mode: 'dialogue_pairs' } }, { ...valid, entry: { ...valid.entry, sources: Array.from({ length: 4 }, () => valid.entry.sources[0]) } }, { ...valid, entry: { ...valid.entry, sources: valid.entry.sources.map(s => ({ ...s, contentDigest: 'broken' })) } }, { ...valid, entry: { ...valid.entry, events: [] } }]) expect(() => parseSummaryCache(value)).toThrow();
});
