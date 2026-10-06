/**
 * Application Port: Structured Logger Interface
 * Defines a pure TypeScript logging boundary for application and domain orchestration.
 *
 * Rules:
 * - No Electron, DOM, React, console, filesystem, or transport dependencies.
 * - Infrastructure adapters own output sinks and buffering behavior.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export type LogEntryLevel = Exclude<LogLevel, 'silent'>;

export type LogContext =
  | 'FSM'
  | 'CharacterEngine'
  | 'Needs'
  | 'AIProvider'
  | 'RenderEngine'
  | 'IPC'
  | 'Autonomy';

export type LogMetadata = Record<string, unknown>;

export interface LogEntry {
  readonly id: string;
  readonly level: LogEntryLevel;
  readonly context: LogContext;
  readonly message: string;
  readonly metadata?: LogMetadata;
  readonly createdAt: string;
}

export interface ILogBuffer {
  readonly maxEntries: number;

  append(entry: LogEntry): void;
  entries(): LogEntry[];
  clear(): void;
}

export interface ILogger {
  debug(context: LogContext, message: string, metadata?: LogMetadata): void;
  info(context: LogContext, message: string, metadata?: LogMetadata): void;
  warn(context: LogContext, message: string, metadata?: LogMetadata): void;
  error(context: LogContext, message: string, metadata?: LogMetadata): void;
  log(level: LogEntryLevel, context: LogContext, message: string, metadata?: LogMetadata): void;

  getLevel(): LogLevel;
  setLevel(level: LogLevel): void;
  isEnabled(): boolean;
  setEnabled(enabled: boolean): void;
  getContextFilter(): LogContext[] | null;
  setContextFilter(contexts: readonly LogContext[] | null): void;
}
