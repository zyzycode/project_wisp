import { expect, it } from 'vitest';
import { InitiativeBudget } from '../../src/application/services/initiative-budget';
it('shares two starts per window and never queues missed episodes', () => {
  const budget = new InitiativeBudget();
  expect(budget.start(0)).toBe(true);
  expect(budget.start(29999)).toBe(false);
  expect(budget.start(30000)).toBe(true);
  expect(budget.start(60000)).toBe(false);
  expect(budget.start(120000)).toBe(true);
  expect(budget.start(120000)).toBe(false);
  expect(budget.available(Number.NaN)).toBe(false);
});
