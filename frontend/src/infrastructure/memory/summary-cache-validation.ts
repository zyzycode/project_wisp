import type { ActiveSummaryReceipt, SummaryCache, SummaryEntry } from '../../application/ports/summary';
import type { LifeSummaryEntry } from '../../application/ports/life-history.interface';
import { summaryPlainText } from '../../shared/summary-text-validation';
import { exactRecord } from '../../shared/dialogue-ipc-validation';
import { summarySources } from './summary-source-reader';
import { utcDate } from './life-history-validation';
import { integer, text } from './validation-primitives';
const digest = (value: unknown): string => { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) throw new TypeError('Invalid digest'); return value; };
export function parseSummaryReceipt(value: unknown, legacy = false): ActiveSummaryReceipt | null {
  if (value === null) return null;
  const r = exactRecord(value, ['commandId', 'requestId', 'sourceDigest', 'admittedAt', 'generatorVersion', ...(legacy ? [] : ['mode'])]);
  const base = { commandId: summaryPlainText(r.commandId, 128), requestId: summaryPlainText(r.requestId, 128), sourceDigest: digest(r.sourceDigest), admittedAt: integer(r.admittedAt) };
  if (r.generatorVersion === 1 && (legacy || r.mode === 'dialogue_pairs')) return { ...base, mode: 'dialogue_pairs', generatorVersion: 1 };
  if (!legacy && r.generatorVersion === 2 && r.mode === 'life_events') return { ...base, mode: 'life_events', generatorVersion: 2 };
  throw new TypeError('Invalid receipt');
}
function pairEntry(value: unknown, legacy: boolean): SummaryEntry & { readonly mode: 'dialogue_pairs' } {
  const e = exactRecord(value, ['text','sources','sourceDigest','factsDigest','locale','generatorVersion', ...(legacy ? [] : ['mode'])]);
  if (e.generatorVersion !== 1 || (e.locale !== 'ru' && e.locale !== 'en') || (!legacy && e.mode !== 'dialogue_pairs')) throw new TypeError('Invalid entry');
  const sources = summarySources(e.sources);
  if (sources.some(source => source.sessionId !== sources[0]?.sessionId) || new Set(sources.flatMap(source => [source.userMessageId, source.assistantMessageId])).size !== sources.length * 2) throw new TypeError('Invalid coverage');
  for (const source of sources) digest(source.revision);
  return { mode: 'dialogue_pairs', text: summaryPlainText(e.text, 1200), sources, sourceDigest: digest(e.sourceDigest), factsDigest: digest(e.factsDigest), locale: e.locale, generatorVersion: 1 };
}
function lifeEntry(value: unknown): LifeSummaryEntry {
  const e = exactRecord(value, ['mode','text','sources','sourceDigest','fromDateUTC','throughDateUTC','locale','generatorVersion']);
  if (e.mode !== 'life_events' || e.generatorVersion !== 2 || (e.locale !== 'ru' && e.locale !== 'en') || !Array.isArray(e.sources) || e.sources.length < 4 || e.sources.length > 8) throw new TypeError('Invalid life entry');
  const fromDateUTC = utcDate(e.fromDateUTC), throughDateUTC = utcDate(e.throughDateUTC), span = (Date.parse(throughDateUTC) - Date.parse(fromDateUTC)) / 86400000;
  if (span < 0 || span > 13) throw new TypeError('Invalid dates');
  const sources = e.sources.map((value: unknown) => { const s = exactRecord(value, ['appRunId','sequence','revision','contentDigest']); if (s.revision !== 1) throw new TypeError('Invalid source revision'); return { appRunId: text(s.appRunId), sequence: integer(s.sequence, 1), revision: 1 as const, contentDigest: digest(s.contentDigest) }; });
  if (new Set(sources.map(s => JSON.stringify([s.appRunId, s.sequence]))).size !== sources.length) throw new TypeError('Duplicate source');
  return { mode: 'life_events', text: summaryPlainText(e.text, 1200), sources, sourceDigest: digest(e.sourceDigest), fromDateUTC, throughDateUTC, locale: e.locale, generatorVersion: 2 };
}
/** Only local format1 migrates; its original hashes and global admission time stay intact. */
export function parseSummaryCache(value: unknown): SummaryCache {
  const r = exactRecord(value, ['formatVersion','entry','receipt']);
  if (r.formatVersion !== 1 && r.formatVersion !== 2) throw new TypeError('Unsupported cache');
  const legacy = r.formatVersion === 1;
  const entry = r.entry === null ? null : !legacy && exactRecord(r.entry, ['mode'], ['text','sources','sourceDigest','factsDigest','locale','generatorVersion','fromDateUTC','throughDateUTC']).mode === 'life_events' ? lifeEntry(r.entry) : pairEntry(r.entry, legacy);
  const receipt = parseSummaryReceipt(r.receipt, legacy);
  if (entry && (!receipt || entry.sourceDigest !== receipt.sourceDigest || entry.mode !== receipt.mode)) throw new TypeError('Missing receipt');
  return { formatVersion: 2, entry, receipt };
}
