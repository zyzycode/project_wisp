import type { CausalSourceReference } from './types';

export type InterruptionReport = 'accidental' | 'deliberate';
export type InterpretationStatus = 'unknown' | 'reported_accidental' | 'reported_deliberate' | 'contradicted';
export interface ClarificationSource {
  readonly conversationSessionId: string;
  readonly userMessageId: string;
  readonly revision: 1;
  readonly report: InterruptionReport;
}
export interface InterruptionInterpretation {
  readonly revision: number;
  readonly episode: CausalSourceReference;
  readonly status: InterpretationStatus;
  readonly reports: readonly ClarificationSource[];
  readonly createdAt: string;
  readonly expiresAt: string;
}
export interface InterpretableEpisode extends CausalSourceReference {
  readonly occurredAt: string;
  readonly source: string;
  readonly activity: string | null;
  readonly outcome: string | null;
  readonly cause: string;
  readonly triggerSequence: number | null;
  readonly executedMs: number;
}
export function recognizeInterruptionReport(text: string): InterruptionReport | null {
  const normalized = text.trim().toLowerCase().replace(/[.!?]$/u, '');
  if (['я случайно прервал игру', 'я случайно прервала игру', 'i interrupted the game by accident'].includes(normalized)) return 'accidental';
  if (['я намеренно прервал игру', 'я намеренно прервала игру', 'i interrupted the game deliberately'].includes(normalized)) return 'deliberate';
  return null;
}
export function createInterruptionInterpretation(episode: InterpretableEpisode, revision: number): InterruptionInterpretation | null {
  const occurred = Date.parse(episode.occurredAt);
  if (episode.revision !== 1 || !episode.appRunId.trim() || !Number.isSafeInteger(episode.sequence) || episode.sequence < 1
    || episode.source !== 'user' || episode.activity !== 'cursor_game' || episode.outcome !== 'cancelled'
    || episode.cause !== 'user_interrupted' || episode.triggerSequence === null || episode.triggerSequence < 1
    || episode.triggerSequence >= episode.sequence || !Number.isFinite(episode.executedMs) || episode.executedMs < 1000
    || episode.executedMs > 600000 || !Number.isFinite(occurred) || !Number.isSafeInteger(revision) || revision < 1) return null;
  return { revision, episode: { appRunId: episode.appRunId, sequence: episode.sequence, revision: 1 }, status: 'unknown', reports: [],
    createdAt: episode.occurredAt, expiresAt: new Date(occurred + 86400000).toISOString() };
}
export function addInterruptionReport(record: InterruptionInterpretation, source: ClarificationSource): InterruptionInterpretation {
  if (record.status === 'contradicted' || record.reports.some(previous => previous.userMessageId === source.userMessageId
      || previous.report === source.report)) return record;
  const reports = [...record.reports, { ...source }];
  return { ...record, revision: record.revision + 1, reports,
    status: reports.length === 2 ? 'contradicted' : source.report === 'accidental' ? 'reported_accidental' : 'reported_deliberate' };
}
export function sameInterpretationEpisode(a: CausalSourceReference, b: CausalSourceReference): boolean {
  return a.appRunId === b.appRunId && a.sequence === b.sequence && a.revision === b.revision;
}
