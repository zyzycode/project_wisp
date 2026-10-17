import { summaryPlainText } from '../../shared/summary-text-validation';
import type { SummaryEntry, SummaryPair, SummarySource, SummarySourceSnapshot } from '../ports/summary';
import { recognizeMemoryFact } from './memory-fact-registry';
export function eligibleSummaryPair(pair: SummaryPair): boolean {
  try { summaryPlainText(pair.userText, 240); summaryPlainText(pair.assistantText, 2000); }
  catch { return false; }
  return pair.eligible && !recognizeMemoryFact(pair.userText) && !/^(?:Исправление:|Correction:|Забудь|Forget)/iu.test(pair.userText.trim());
}
export function selectSummaryPairs(pairs: readonly SummaryPair[]): readonly SummaryPair[] {
  const older = pairs.slice(0, -3);
  let end = older.length;
  while (end > 0) {
    if (!eligibleSummaryPair(older[end - 1]!)) { end--; continue; }
    let start = end - 1;
    while (start > 0 && eligibleSummaryPair(older[start - 1]!) && older[start - 1]!.sessionId === older[end - 1]!.sessionId) start--;
    for (let count = Math.min(8, end - start); count >= 4; count--) {
      const selected = older.slice(end - count, end);
      if (selected.reduce((sum, pair) => sum + pair.userText.length + pair.assistantText.length, 0) <= 8000) return selected;
    }
    end = start;
  }
  return [];
}
export function sourceMetadata(pairs: readonly SummaryPair[], hash: (text: string) => string): readonly SummarySource[] {
  return pairs.map(p => ({ userMessageId: p.userMessageId, assistantMessageId: p.assistantMessageId, sessionId: p.sessionId,
    revision: hash(JSON.stringify([p.userMessageId, p.assistantMessageId, p.sessionId, p.userText, p.assistantText, p.eligible])) }));
}
export function factsDigest(snapshot: SummarySourceSnapshot, hash: (text: string) => string): string {
  return hash(JSON.stringify([...snapshot.facts].sort((a, b) => a.factKey < b.factKey ? -1 : a.factKey > b.factKey ? 1 : 0)));
}
export function matchesSummary(entry: SummaryEntry, snapshot: SummarySourceSnapshot, hash: (text: string) => string): boolean {
  const sources = sourceMetadata(snapshot.pairs, hash);
  return snapshot.pairs.every(eligibleSummaryPair) && JSON.stringify(entry.sources) === JSON.stringify(sources)
    && entry.sourceDigest === hash(JSON.stringify(sources)) && entry.factsDigest === factsDigest(snapshot, hash);
}
export function summaryMatchesText(text: string, summary: string): boolean {
  const tokens = (value: string) => value.normalize('NFC').toLowerCase().match(/[\p{L}\p{N}]+/gu)?.filter(token => token.length >= 2 && token.length <= 64) ?? [];
  const selected = new Set(tokens(summary)); return tokens(text).some(token => selected.has(token));
}
