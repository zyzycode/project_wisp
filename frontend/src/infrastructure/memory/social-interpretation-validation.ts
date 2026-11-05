import type { InterruptionClarificationSource, SocialInterpretation } from '../../application/ports/social-interpretation.interface';
import { causalSources } from './causal-life-validation';
import { integer, MemoryDataError, record, text, timestamp } from './validation-primitives';

export function socialInterpretation(value: unknown): SocialInterpretation {
  const p = record(value, ['revision', 'episode', 'status', 'reports', 'createdAt', 'expiresAt']);
  const [episode] = causalSources([p.episode]);
  if (!episode || !Array.isArray(p.reports) || p.reports.length > 2) throw new MemoryDataError('invalid_data');
  const reports = p.reports.map<InterruptionClarificationSource>((entry: unknown) => {
    const source = record(entry, ['conversationSessionId', 'userMessageId', 'revision', 'report']);
    if (source.revision !== 1 || (source.report !== 'accidental' && source.report !== 'deliberate')) throw new MemoryDataError('invalid_data');
    return { conversationSessionId: text(source.conversationSessionId), userMessageId: text(source.userMessageId), revision: 1 as const, report: source.report };
  });
  const status = p.status;
  if ((status !== 'unknown' && status !== 'reported_accidental' && status !== 'reported_deliberate' && status !== 'contradicted')
    || (status === 'unknown' ? reports.length !== 0 : status === 'contradicted' ? reports.length !== 2 || reports[0]!.report === reports[1]!.report
      : reports.length !== 1 || status !== `reported_${reports[0]!.report}`)
    || new Set(reports.map(source => source.userMessageId)).size !== reports.length) throw new MemoryDataError('invalid_data');
  const createdAt = timestamp(p.createdAt), expiresAt = timestamp(p.expiresAt);
  if (Date.parse(expiresAt) - Date.parse(createdAt) !== 86400000) throw new MemoryDataError('invalid_data');
  return { revision: integer(p.revision, 1), episode, status, reports, createdAt, expiresAt };
}
