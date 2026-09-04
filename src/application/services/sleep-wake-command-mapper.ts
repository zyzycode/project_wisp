import type { BehaviorIntent } from '../../domain/behavior/behavior-intent';

export interface SleepWakeCommand {
  readonly action: 'sleep' | 'wake';
}

/** Maps a validated explicit user command into a Character-owned semantic candidate. */
export function mapSleepWakeCommand(command: SleepWakeCommand): BehaviorIntent {
  return command.action === 'sleep'
    ? {
        kind: 'sleep',
        source: 'user',
        priority: 'high',
        reason: 'user_sleep_command',
      }
    : {
        kind: 'wake',
        source: 'user',
        priority: 'critical',
        reason: 'user_wake_command',
      };
}
