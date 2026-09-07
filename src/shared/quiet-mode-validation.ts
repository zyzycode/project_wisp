import type { AutonomyModeDTO, SetQuietModeDTO } from './ipc-contracts';
function exactBoolean(value: unknown, key: string): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
      || Object.keys(value).length !== 1 || !Object.hasOwn(value, key)) throw new TypeError('Invalid mode payload');
  const field: unknown = Reflect.get(value, key);
  if (typeof field !== 'boolean') throw new TypeError('Invalid mode value');
  return field;
}
export function parseQuietModeCommand(value: unknown): SetQuietModeDTO { return { enabled: exactBoolean(value, 'enabled') }; }
export function parseAutonomyMode(value: unknown): AutonomyModeDTO { return { quiet: exactBoolean(value, 'quiet') }; }
