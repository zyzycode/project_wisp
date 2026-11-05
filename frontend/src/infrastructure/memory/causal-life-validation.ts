import type { CausalLifeEpisode, CausalLifeSourceReference } from '../../application/ports/causal-life.interface';
import { MemoryDataError, finite, integer, record, text, timestamp } from './validation-primitives';

function member<const T extends readonly (string | null)[]>(value: unknown, values: T): T[number] {
  if (!values.some(candidate => candidate === value)) throw new MemoryDataError('invalid_data');
  return value as T[number];
}
export function causalEpisode(value: unknown): CausalLifeEpisode {
  const p = record(value, ['appRunId', 'sequence', 'revision', 'occurredAt', 'source', 'triggerSequence', 'activityRunId', 'activity', 'outcome', 'terminalReason', 'cause', 'executedMs', 'participation']);
  if (p.revision !== 1) throw new MemoryDataError('invalid_data');
  const e: CausalLifeEpisode = {
    appRunId: text(p.appRunId), sequence: integer(p.sequence, 1), revision: 1, occurredAt: timestamp(p.occurredAt),
    source: member(p.source, ['user', 'system', 'autonomy', 'unknown']),
    triggerSequence: p.triggerSequence === null ? null : integer(p.triggerSequence, 1),
    activityRunId: p.activityRunId === null ? null : text(p.activityRunId),
    activity: member(p.activity, ['cursor_game', null]), outcome: member(p.outcome, ['completed', 'cancelled', 'failed', null]),
    terminalReason: member(p.terminalReason, ['forced_motion', 'user_interaction', 'critical_need', 'higher_priority_activity', 'environment_invalidated', 'animation_rejected', 'step_timeout', 'explicit_cancel', 'application_shutdown', 'invalid_definition', 'unresolved_target', null]),
    cause: member(p.cause, ['contact', 'completed', 'user_interrupted', 'environment_lost', 'timeout', 'other', 'unknown']),
    executedMs: finite(p.executedMs, 0, 600000), participation: member(p.participation, ['user_engaged', 'solitary', 'none']),
  };
  if (e.triggerSequence !== null && e.triggerSequence >= e.sequence) throw new MemoryDataError('invalid_data');
  if (e.cause === 'contact') {
    if (e.activity !== null || e.activityRunId !== null || e.outcome !== null || e.terminalReason !== null || e.executedMs !== 0 || e.participation !== 'none' || e.source !== 'user' || e.triggerSequence !== null) throw new MemoryDataError('invalid_data');
  } else {
    if (e.activity !== 'cursor_game' || e.activityRunId === null || e.outcome === null || e.participation === 'none' || (e.outcome === 'completed') !== (e.cause === 'completed')) throw new MemoryDataError('invalid_data');
    if (e.cause === 'user_interrupted' && (e.source !== 'user' || e.triggerSequence === null || e.outcome !== 'cancelled' || e.terminalReason !== 'user_interaction')) throw new MemoryDataError('invalid_data');
    if (e.outcome === 'completed' && e.terminalReason !== null) throw new MemoryDataError('invalid_data');
    if (e.cause === 'environment_lost' && (e.terminalReason !== 'environment_invalidated' || e.source !== 'system')) throw new MemoryDataError('invalid_data');
    if (e.cause === 'timeout' && (e.terminalReason !== 'step_timeout' || e.source !== 'system')) throw new MemoryDataError('invalid_data');
    if (e.cause === 'unknown' && (e.source !== 'unknown' || e.triggerSequence !== null || (e.terminalReason !== null && e.terminalReason !== 'user_interaction'))) throw new MemoryDataError('invalid_data');
    if (e.cause === 'other' && (e.source !== 'system' || e.triggerSequence !== null || e.terminalReason === null
      || ['user_interaction', 'environment_invalidated', 'step_timeout'].includes(e.terminalReason))) throw new MemoryDataError('invalid_data');
  }
  return e;
}
export function causalSources(value: unknown): readonly CausalLifeSourceReference[] {
  if (!Array.isArray(value) || value.length > 20) throw new MemoryDataError('invalid_data');
  const seen = new Set<string>();
  return value.map((entry: unknown) => {
    const p = record(entry, ['appRunId', 'sequence', 'revision']);
    if (p.revision !== 1) throw new MemoryDataError('invalid_data');
    const ref: CausalLifeSourceReference = { appRunId: text(p.appRunId), sequence: integer(p.sequence, 1), revision: 1 };
    const key = JSON.stringify([ref.appRunId, ref.sequence]);
    if (seen.has(key)) throw new MemoryDataError('invalid_data');
    seen.add(key); return ref;
  });
}
