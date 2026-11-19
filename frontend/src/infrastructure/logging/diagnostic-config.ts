import type { LogLevel } from '../../application/ports/logger.interface';

const DESKTOP_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error', 'silent'];
const BACKEND_LEVELS = ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL', 'OFF'] as const;
export type BackendLogLevel = typeof BACKEND_LEVELS[number];

export function desktopLogPolicy(value: string | undefined): { level: LogLevel; invalid: boolean } {
  const level = DESKTOP_LEVELS.find(candidate => candidate === value);
  return { level: level ?? 'warn', invalid: value !== undefined && level === undefined };
}
export function backendLogPolicy(value: string | undefined): { level: BackendLogLevel; invalid: boolean } {
  const level = BACKEND_LEVELS.find(candidate => candidate === value);
  return { level: level ?? 'WARNING', invalid: value !== undefined && level === undefined };
}
