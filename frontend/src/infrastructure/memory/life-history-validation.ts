import type { LifeHistoryWindow, LifeHistoryWindowQuery } from '../../application/ports/life-history.interface';
import { causalEpisode } from './causal-life-validation';
import { integer, MemoryDataError, record, text, timestamp } from './validation-primitives';

export function utcDate(value: unknown): string {
  const date = text(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00.000Z`)) || new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) !== date) throw new MemoryDataError('invalid_data');
  return date;
}
export function lifeWindowQuery(value: unknown): LifeHistoryWindowQuery {
  const p = record(value, ['fromDateUTC', 'throughDateUTC', 'asOf']);
  const fromDateUTC = utcDate(p.fromDateUTC), throughDateUTC = utcDate(p.throughDateUTC), asOf = timestamp(p.asOf);
  const span = (Date.parse(throughDateUTC) - Date.parse(fromDateUTC)) / 86400000 + 1;
  if (span < 1 || span > 14 || asOf.slice(0, 10) !== throughDateUTC) throw new MemoryDataError('invalid_data');
  return { fromDateUTC, throughDateUTC, asOf };
}
export function lifeWindow(value: unknown): LifeHistoryWindow {
  const p = record(value, ['coverage', 'events', 'examined', 'fetched']);
  if (p.coverage !== 'complete' && p.coverage !== 'index_building' && p.coverage !== 'overflow' && p.coverage !== 'clock_unknown') throw new MemoryDataError('invalid_data');
  if (!Array.isArray(p.events) || p.events.length > 1000 || (p.coverage !== 'complete' && p.events.length !== 0)) throw new MemoryDataError('invalid_data');
  return { coverage: p.coverage, events: p.events.map(causalEpisode), examined: integer(p.examined, 0, 1001), fetched: integer(p.fetched, 0, 1000) };
}
