import { lifeWindow, lifeWindowQuery } from './life-history-validation';
import { deferredInvitation, deferredTerminal } from './deferred-invitation-validation';
import { socialInterpretation } from './social-interpretation-validation';
import { motivationRecord } from './motivation-validation';
import { causalEpisode, causalSources } from './causal-life-validation';
import { causalRecallPage, causalRecallQuery } from './causal-recall-validation';
import { routineStart, routineObservation, routineIdentity, routineStatus } from './routine-validation';
import { topicRead, topicMutation, topicReservation, topicReceipt, topicCapture } from './interest-thread-validation';
import { summarySources, summarySnapshot } from './summary-source-reader';
import type { MemoryFailureCode, MemoryResult } from '../../application/ports/memory-repository.interface';
import { itemMutation, itemListQuery, itemReceipt, itemPage, itemRecallTokens, itemCandidates } from './item-validation';
import * as v from './validation';

export type Operation = 'readLifeWindow' | 'restoreMotivation' | 'readMotivation' | 'replaceMotivation' | 'readSocialInterpretation' | 'replaceSocialInterpretation' | 'clearSocialInterpretation' | 'createDeferredInvitation' | 'readDeferredInvitation' | 'claimDeferredInvitation' | 'finishDeferredInvitation' | 'findCausalLife' | 'findMemoryItems' | 'appendCausalLife' | 'recentCausalLife' | 'resolveCausalLife' | 'beginRoutine' | 'appendRoutine' | 'readRoutineStatus' | 'readInterestThread' | 'mutateInterestThread' | 'claimInterestThread' | 'captureInterestThreadReply' | 'summaryRecent' | 'summaryExact' | 'mutateMemoryItem' | 'listMemoryItems' | 'appendTurn' | 'getRecent' | 'closeSession' | 'closeUnfinishedSessions' | 'upsertFact' | 'removeFact' | 'listFacts' | 'appendEpisode' | 'getRecentEpisodes' | 'loadSnapshot' | 'saveSnapshot' | 'clear' | 'close';
export interface Command { readonly id: number; readonly generation: number; readonly operation: Operation; readonly payload: unknown }
export interface Reply { readonly id: number; readonly result: MemoryResult<unknown> }
const operations: readonly string[] = ['readLifeWindow', 'restoreMotivation', 'readMotivation', 'replaceMotivation', 'readSocialInterpretation', 'replaceSocialInterpretation', 'clearSocialInterpretation', 'createDeferredInvitation', 'readDeferredInvitation', 'claimDeferredInvitation', 'finishDeferredInvitation', 'findCausalLife', 'findMemoryItems', 'appendCausalLife', 'recentCausalLife', 'resolveCausalLife', 'beginRoutine', 'appendRoutine', 'readRoutineStatus', 'readInterestThread', 'mutateInterestThread', 'claimInterestThread', 'captureInterestThreadReply', 'summaryRecent', 'summaryExact', 'mutateMemoryItem', 'listMemoryItems', 'appendTurn', 'getRecent', 'closeSession', 'closeUnfinishedSessions', 'upsertFact', 'removeFact', 'listFacts', 'appendEpisode', 'getRecentEpisodes', 'loadSnapshot', 'saveSnapshot', 'clear', 'close'];
const codes: readonly string[] = ['unavailable', 'busy', 'storage_full', 'corrupt', 'unsupported_version', 'invalid_data', 'conflict', 'stale', 'io_error'];
export function command(value: unknown): Command {
  const c = v.record(value, ['id', 'generation', 'operation', 'payload']);
  if (typeof c.operation !== 'string' || !operations.includes(c.operation)) throw new v.MemoryDataError('invalid_data');
  const operation = c.operation as Operation;
  let payload: unknown;
  switch (operation) {
    case 'restoreMotivation':
    case 'readMotivation': payload = v.timestamp(c.payload); break;
    case 'replaceMotivation': { const p = v.record(c.payload,['value','expectedRevision']); payload = { value: motivationRecord(p.value), expectedRevision: p.expectedRevision === null ? null : v.integer(p.expectedRevision,1) }; break; }
    case 'readSocialInterpretation': payload = v.timestamp(c.payload); break;
    case 'clearSocialInterpretation': payload = v.integer(c.payload, 1); break;
    case 'replaceSocialInterpretation': { const p = v.record(c.payload,['value','expectedRevision','now']); payload = { value: socialInterpretation(p.value), expectedRevision: p.expectedRevision === null ? null : v.integer(p.expectedRevision,1), now: v.timestamp(p.now) }; break; }
    case 'createDeferredInvitation': payload = deferredInvitation(c.payload); break;
    case 'readDeferredInvitation': payload = v.timestamp(c.payload); break;
    case 'claimDeferredInvitation': { const p = v.record(c.payload,['id','now']); payload = { id: v.text(p.id), now: v.timestamp(p.now) }; break; }
    case 'finishDeferredInvitation': { const p = v.record(c.payload,['id','state']); payload = { id: v.text(p.id), state: deferredTerminal(p.state) }; break; }
    case 'readLifeWindow': payload = lifeWindowQuery(c.payload); break;
    case 'findCausalLife': payload = causalRecallQuery(c.payload); break;
    case 'findMemoryItems': payload = itemRecallTokens(c.payload); break;
    case 'appendCausalLife': payload = causalEpisode(c.payload); break;
    case 'resolveCausalLife': payload = causalSources(c.payload); break;
    case 'recentCausalLife': payload = v.integer(c.payload, 1, 100); break;
    case 'beginRoutine': payload = routineStart(c.payload); break;
    case 'appendRoutine': payload = routineObservation(c.payload); break;
    case 'mutateInterestThread': payload = topicMutation(c.payload); break;
    case 'claimInterestThread': case 'captureInterestThreadReply': payload = topicReservation(c.payload); break;
    case 'summaryExact': payload = summarySources(c.payload); break;
    case 'mutateMemoryItem': payload = itemMutation(c.payload); break;
    case 'listMemoryItems': payload = itemListQuery(c.payload); break;
    case 'getRecentEpisodes': payload = v.integer(c.payload, 1, 20); break;
    case 'appendTurn': payload = v.turn(c.payload); break;
    case 'getRecent': case 'listFacts': payload = v.integer(c.payload, 1, 100); break;
    case 'closeSession': { const p = v.record(c.payload, ['sessionId', 'endedAt']); payload = { sessionId: v.text(p.sessionId), endedAt: v.timestamp(p.endedAt) }; break; }
    case 'closeUnfinishedSessions': payload = v.timestamp(c.payload); break;
    case 'upsertFact': payload = v.fact(c.payload); break;
    case 'removeFact': payload = v.text(c.payload); break;
    case 'appendEpisode': payload = v.episode(c.payload); break;
    case 'saveSnapshot': payload = v.writableSnapshot(c.payload); break;
    default: if (c.payload !== null) throw new v.MemoryDataError('invalid_data'); payload = null;
  }
  return { id: v.integer(c.id, 1), generation: v.integer(c.generation), operation, payload };
}
export function reply(value: unknown): Reply {
  const r = v.record(value, ['id', 'result']), result = v.record(r.result);
  const id = v.integer(r.id);
  if (result.ok === true) { v.record(result, ['ok', 'value']); return { id, result: { ok: true, value: result.value } }; }
  if (result.ok !== false || typeof result.code !== 'string' || !codes.includes(result.code)) throw new v.MemoryDataError('invalid_data');
  v.record(result, ['ok', 'code']);
  return { id, result: { ok: false, code: result.code as MemoryFailureCode } };
}
export function failure(error: unknown): MemoryResult<never> {
  if (error instanceof v.MemoryDataError) return { ok: false, code: error.code };
  if (error instanceof TypeError || error instanceof SyntaxError) return { ok: false, code: 'invalid_data' };
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  if (typeof code !== 'string') return { ok: false, code: 'unavailable' };
  if (code.startsWith('SQLITE_BUSY') || code.startsWith('SQLITE_LOCKED')) return { ok: false, code: 'busy' };
  if (code.startsWith('SQLITE_CONSTRAINT')) return { ok: false, code: 'conflict' };
  if (code === 'SQLITE_FULL' || code === 'ENOSPC') return { ok: false, code: 'storage_full' };
  if (code.startsWith('SQLITE_CORRUPT') || code === 'SQLITE_NOTADB') return { ok: false, code: 'corrupt' };
  return { ok: false, code: 'io_error' };
}

export function responseValue(operation: Operation, value: unknown): unknown {
  switch (operation) {
    case 'restoreMotivation':
    case 'readMotivation': return value === null ? null : motivationRecord(value);
    case 'readSocialInterpretation': return value === null ? null : socialInterpretation(value);
    case 'readDeferredInvitation': return value === null ? null : deferredInvitation(value);
    case 'claimDeferredInvitation': if (typeof value !== 'boolean') throw new v.MemoryDataError('invalid_data'); return value;
    case 'readLifeWindow': return lifeWindow(value);
    case 'findCausalLife': return causalRecallPage(value);
    case 'findMemoryItems': return itemCandidates(value);
    case 'recentCausalLife': case 'resolveCausalLife': {
      if (!Array.isArray(value) || value.length > (operation === 'resolveCausalLife' ? 20 : 100)) throw new v.MemoryDataError('invalid_data');
      return value.map(causalEpisode);
    }
    case 'beginRoutine': return routineIdentity(value);
    case 'readRoutineStatus': return routineStatus(value);
    case 'readInterestThread': return topicRead(value);
    case 'mutateInterestThread': return topicReceipt(value);
    case 'claimInterestThread': case 'captureInterestThreadReply': return topicCapture(value);
    case 'summaryRecent': case 'summaryExact': return summarySnapshot(value);
    case 'mutateMemoryItem': return itemReceipt(value);
    case 'listMemoryItems': return itemPage(value);
    case 'getRecent': case 'listFacts': {
      if (!Array.isArray(value) || value.length > 100) throw new v.MemoryDataError('invalid_data');
      return value.map((item: unknown) => operation === 'getRecent' ? v.message(item) : v.fact(item));
    }
    case 'getRecentEpisodes': {
      if (!Array.isArray(value) || value.length > 20) throw new v.MemoryDataError('invalid_data');
      return value.map(v.episode);
    }
    case 'upsertFact': return v.fact(value);
    case 'loadSnapshot': return value === null ? null : v.snapshot(value);
    default: if (value !== undefined) throw new v.MemoryDataError('invalid_data'); return undefined;
  }
}
