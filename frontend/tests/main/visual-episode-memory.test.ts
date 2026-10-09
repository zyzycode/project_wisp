import { expect, it } from 'vitest';
import { scenario } from './autonomy-scenario-fixture';

it('keeps Main visual episode identity bookkeeping constant over 25000 reactions', () => {
  const f = scenario();
  for (let index = 0; index < 25000; index++) f.main.handleClick();
  const retained = Object.values(f.main).filter(value => value instanceof Map || value instanceof Set)
    .reduce((sum, value) => sum + value.size, 0);
  expect(retained).toBeLessThanOrEqual(64);
  f.main.stop();
});
