import { describe, expect, it } from 'vitest';
import { mapSleepWakeCommand } from '../../src/application/services/sleep-wake-command-mapper';

describe('Application: sleep/wake command mapper', () => {
  it('maps exact user commands without deciding semantic acceptance', () => {
    expect(mapSleepWakeCommand({ action: 'sleep' })).toEqual({
      kind: 'sleep',
      source: 'user',
      priority: 'high',
      reason: 'user_sleep_command',
    });
    expect(mapSleepWakeCommand({ action: 'wake' })).toEqual({
      kind: 'wake',
      source: 'user',
      priority: 'critical',
      reason: 'user_wake_command',
    });
  });
});
