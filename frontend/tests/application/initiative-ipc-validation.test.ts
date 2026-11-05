import { expect, it } from 'vitest';
import { parseInitiativeConsent, parseInitiativeRead, parseWindowHelpDecline } from '../../src/shared/initiative-ipc-validation';
it('accepts only exact typed local session commands, never renderer success claims', () => {
  expect(parseInitiativeConsent({ streamId: 's', profileGeneration: 2, enabled: false })).toEqual({
    streamId: 's', profileGeneration: 2, enabled: false,
  });
  for (const profileGeneration of [-1, .5, NaN, Infinity, '2', null]) {
    expect(() => parseInitiativeConsent({ streamId: 's', profileGeneration, enabled: true })).toThrow();
  }
  expect(() => parseInitiativeRead({ streamId: 's', enabled: true })).toThrow();
  expect(() => parseWindowHelpDecline({ streamId: 's', requestId: 'r', outcome: 'fulfilled' })).toThrow();
  expect(() => parseWindowHelpDecline({ streamId: '', requestId: 'r' })).toThrow();
  expect(parseWindowHelpDecline({ streamId: 's', requestId: 'r' })).toEqual({ streamId: 's', requestId: 'r' });
});
