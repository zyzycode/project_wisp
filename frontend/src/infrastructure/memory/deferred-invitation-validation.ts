import type { DeferredGameInvitation } from '../../application/ports/causal-life.interface';
import { invitationWindow } from '../../domain/behavior/deferred-game-invitation';
import { integer, MemoryDataError, record, text, timestamp } from './validation-primitives';
export function deferredInvitation(value: unknown): DeferredGameInvitation {
  const p = record(value, ['id', 'sourceAppRunId', 'sourceSequence', 'createdAt', 'notBefore', 'expiresAt', 'state']);
  const state = p.state;
  if (state !== 'pending' && state !== 'claimed' && state !== 'completed' && state !== 'cancelled' && state !== 'expired' && state !== 'abandoned') throw new MemoryDataError('invalid_data');
  const createdAt = timestamp(p.createdAt), notBefore = timestamp(p.notBefore), expiresAt = timestamp(p.expiresAt);
  const expected = invitationWindow(createdAt);
  if (expected.notBefore !== notBefore || expected.expiresAt !== expiresAt) throw new MemoryDataError('invalid_data');
  return { id: text(p.id), sourceAppRunId: text(p.sourceAppRunId), sourceSequence: integer(p.sourceSequence, 1), createdAt, notBefore, expiresAt, state };
}
export function deferredTerminal(value: unknown): 'completed' | 'cancelled' | 'expired' | 'abandoned' {
  if (value !== 'completed' && value !== 'cancelled' && value !== 'expired' && value !== 'abandoned') throw new MemoryDataError('invalid_data');
  return value;
}
