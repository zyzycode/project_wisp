import { expect, it } from 'vitest';
import { allowsDeferredInvitationContext } from '../../src/domain/behavior/computer-opportunity';
it('only fresh settling vetoes; stable, unknown and missing/invalid context never grant permission', () => {
  expect(allowsDeferredInvitationContext({ foreground: 'settling', sampledAtMs: 0 }, 2500)).toBe(false);
  expect(allowsDeferredInvitationContext({ foreground: 'settling', sampledAtMs: 0 }, 2501)).toBe(true);
  for (const foreground of ['stable', 'unknown'] as const) expect(allowsDeferredInvitationContext({ foreground, sampledAtMs: 0 }, 0)).toBe(true);
  for (const sampledAtMs of [-1, 1, NaN, Infinity]) expect(allowsDeferredInvitationContext({ foreground: 'settling', sampledAtMs }, 0)).toBe(true);
  expect(allowsDeferredInvitationContext(undefined, 0)).toBe(true);
});
