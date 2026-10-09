import { expect, it } from 'vitest';
import { recordFailedExploreTarget, canRetryExploreTarget, type FailedExploreTarget } from '../../src/domain/behavior/explore-planner';

it('bounds retry memory and permits targets exactly at expiry', () => {
  let memory: readonly FailedExploreTarget[] = [];
  for (let i = 0; i < 1000; i++) memory = recordFailedExploreTarget(memory, `target-${i}`, i);
  expect(memory).toHaveLength(12);
  expect(canRetryExploreTarget(memory, 'target-0', 1000)).toBe(true);
  expect(canRetryExploreTarget(memory, 'target-999', 30998)).toBe(false);
  expect(canRetryExploreTarget(memory, 'target-999', 30999)).toBe(true);
  memory = recordFailedExploreTarget(memory, 'target-999', 31000);
  expect(memory).toEqual([{ targetId: 'target-999', retryAtMs: 61000 }]);
});

it('replaces repeated failure for a target without growing the ledger', () => {
  const once = recordFailedExploreTarget([], 'same', 0);
  const twice = recordFailedExploreTarget(once, 'same', 100);
  expect(twice).toEqual([{ targetId: 'same', retryAtMs: 30100 }]);
});
