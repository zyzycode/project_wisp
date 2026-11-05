import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { parseLifeReflection } from '../../src/infrastructure/ai/backend-life-reflection';
import { projectInteractionChat } from '../../src/infrastructure/ai/backend-interaction-validation';
import { providerRequest } from './backend-ai-fixture';
const read = (name: string): unknown => JSON.parse(readFileSync(path.resolve('../docs/contracts/fixtures/desktop-backend-v1/life-history/reflection', name), 'utf8'));
it('independently validates the shared strict reflection corpus and retains the exact absent baseline', () => {
  const full = parseLifeReflection(read('full.json')), matrix = read('invalid.json');
  if (!Array.isArray(matrix)) throw new Error('Invalid matrix');
  for (const entry of matrix) expect(() => parseLifeReflection(entry.value), entry.name).toThrow();
  const request = providerRequest(), baseline = projectInteractionChat(request);
  expect(baseline).not.toHaveProperty('lifeReflection');
  const enriched = projectInteractionChat({ ...request, lifeReflection: { kind: full.kind, fromDateUTC: full.fromDate, throughDateUTC: full.throughDate, completedCount: full.completedCount, interruptedCount: full.interruptedCount, completedUtcDays: full.completedDays } });
  const { lifeReflection, ...withoutReflection } = enriched;
  expect(lifeReflection).toEqual(full); expect(withoutReflection).toEqual(baseline);
});
