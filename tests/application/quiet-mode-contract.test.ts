import { expect, it } from 'vitest';
import { parseQuietModeCommand, parseAutonomyMode } from '../../src/shared/quiet-mode-validation';
it('accepts only exact boolean mode commands and snapshots', () => {
  expect(parseQuietModeCommand({ enabled: true })).toEqual({ enabled: true });
  expect(parseAutonomyMode({ quiet: false })).toEqual({ quiet: false });
  for (const value of [null, true, [], { enabled: 1 }, { enabled: true, extra: false }, { quiet: true }]) {
    expect(() => parseQuietModeCommand(value)).toThrow();
  }
});
