import { expect, it } from 'vitest';
import { AIRequestControl } from '../../src/application/services/ai-request-control';

it('charges only recorded sends, including failures, with an open left minute boundary', () => {
  const control = new AIRequestControl();
  for (let i = 0; i < 100; i++) expect(control.availability(0)).toEqual({ available: true });
  for (let i = 0; i < 6; i++) expect(control.recordSubmission(1000 + i)).toBe(true);
  expect(control.recordSubmission(60_999)).toBe(false);
  expect(control.availability(60_999)).toEqual({ available: false, reason: 'rate_limited', retryAtMs: 61_000 });
  expect(control.recordSubmission(61_000)).toBe(true);
  expect(control.availability(61_000)).toMatchObject({ available: false, retryAtMs: 61_001 });
});
it('counts 100 submissions across minute windows and stays exhausted for the Main session', () => {
  const control = new AIRequestControl();
  for (let i = 0; i < 100; i++) expect(control.recordSubmission(i * 60_000)).toBe(true);
  expect(control.availability(100 * 60_000)).toEqual({ available: false, reason: 'budget_exhausted' });
  expect(control.recordSubmission(100_000_000)).toBe(false);
});
it('uses the longer of rate and transport cooldown, without shortening an existing cooldown', () => {
  const control = new AIRequestControl();
  for (let i = 0; i < 6; i++) control.recordSubmission(0);
  control.deferUntil(30_000);
  expect(control.availability(0)).toMatchObject({ retryAtMs: 60_000 });
  control.deferUntil(80_000); control.deferUntil(70_000);
  expect(control.availability(60_000)).toEqual({ available: false, reason: 'unavailable', retryAtMs: 80_000 });
  expect(control.availability(80_000)).toEqual({ available: true });
});
