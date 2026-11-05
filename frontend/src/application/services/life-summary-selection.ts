import type { CausalLifeEpisode } from '../ports/causal-life.interface';
import type { LifeSummaryEntry, LifeSummaryEvent, LifeSummarySource } from '../ports/life-history.interface';

export function lifeSummaryEvent(e: CausalLifeEpisode): LifeSummaryEvent | undefined {
  if (e.activity !== 'cursor_game' || !e.outcome || !['completed', 'user_interrupted', 'environment_lost', 'timeout'].includes(e.cause)) return undefined;
  const cause = e.cause;
  if (cause !== 'completed' && cause !== 'user_interrupted' && cause !== 'environment_lost' && cause !== 'timeout') return undefined;
  return { activity: 'cursor_game', outcome: e.outcome, cause, actor: e.source, participation: e.participation, executedMs: e.executedMs, occurredAt: e.occurredAt };
}
export function selectLifeSummary(events: readonly CausalLifeEpisode[]): readonly CausalLifeEpisode[] {
  const identities = new Set<string>(), runs = new Set<string>();
  for (let i = 0; i < events.length; i++) {
    const event = events[i]!, identity = JSON.stringify([event.appRunId, event.sequence, event.revision]), run = JSON.stringify([event.appRunId, event.activityRunId]);
    if (identities.has(identity) || (event.activityRunId !== null && runs.has(run)) || (i > 0 && event.occurredAt < events[i-1]!.occurredAt)) return [];
    identities.add(identity); if (event.activityRunId !== null) runs.add(run);
  }
  return events.filter(e => lifeSummaryEvent(e) !== undefined).slice(-8);
}
export function lifeSummarySources(events: readonly CausalLifeEpisode[], hash: (text: string) => string): readonly LifeSummarySource[] {
  return events.map(e => ({ appRunId: e.appRunId, sequence: e.sequence, revision: 1, contentDigest: hash(JSON.stringify(e)) }));
}
export function lifeSummaryDigest(entry: Pick<LifeSummaryEntry, 'mode' | 'locale' | 'fromDateUTC' | 'throughDateUTC' | 'sources'>, hash: (text: string) => string): string {
  return hash(JSON.stringify([entry.mode, entry.locale, entry.fromDateUTC, entry.throughDateUTC, entry.sources]));
}
export function matchesLifeSummary(entry: LifeSummaryEntry, events: readonly CausalLifeEpisode[], hash: (text: string) => string): boolean {
  return events.length === entry.sources.length && events.every(e => lifeSummaryEvent(e) !== undefined && e.occurredAt.slice(0, 10) >= entry.fromDateUTC && e.occurredAt.slice(0, 10) <= entry.throughDateUTC)
    && JSON.stringify(lifeSummarySources(events, hash)) === JSON.stringify(entry.sources) && lifeSummaryDigest(entry, hash) === entry.sourceDigest;
}

export function validateLifeSummaryRange(fromDateUTC: string, throughDateUTC: string, asOf: string): void {
  for (const value of [fromDateUTC, throughDateUTC]) {
    if (!/^\d{4}-\d\d-\d\d$/u.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new TypeError('Invalid observed UTC date');
  }
  const days = (Date.parse(throughDateUTC) - Date.parse(fromDateUTC)) / 86400000;
  if (days < 0 || days > 13 || throughDateUTC > asOf.slice(0, 10)) throw new TypeError('Invalid observed UTC range');
}
