import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { parseSummaryRequest } from '../../src/infrastructure/ai/backend-summary-validation';
import { parseLifeSummaryContext } from '../../src/infrastructure/ai/backend-life-summary';
import { projectInteractionChat } from '../../src/infrastructure/ai/backend-interaction-validation';
import { providerRequest } from './backend-ai-fixture';
const read = (name: string): unknown => JSON.parse(readFileSync(path.resolve('../docs/contracts/fixtures/desktop-backend-v1/life-history/life-summary', name), 'utf8'));
it('independently validates exact mutually exclusive source forms and the shared invalid corpus', () => {
  const valid = parseSummaryRequest(read('request.valid.json')); expect(valid).toEqual(read('request.valid.json')); expect(valid).toHaveProperty('events');
  const matrix = read('invalid.json'); if (!Array.isArray(matrix)) throw new Error('Invalid matrix');
  for (const entry of matrix) expect(() => entry.kind === 'request' ? parseSummaryRequest(entry.value) : parseLifeSummaryContext(entry.value), entry.name).toThrow();
});
it('projects a life summary only into ordinary summary context and omits reflection in that request', () => {
  const context = parseLifeSummaryContext(read('context.valid.json')), request = providerRequest();
  const result = projectInteractionChat({ ...request, summary: context, lifeReflection: { kind: 'shared_game_completions', fromDateUTC: context.fromDate, throughDateUTC: context.throughDate, completedCount: 6, interruptedCount: 0, completedUtcDays: 3 } });
  expect(result.summary).toEqual(context); expect(result).not.toHaveProperty('lifeReflection');
});
