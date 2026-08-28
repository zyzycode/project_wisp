import type {
  ILogger,
  ILogBuffer,
  LogContext,
  LogEntry,
  LogEntryLevel,
  LogLevel,
  LogMetadata,
} from '../../application/ports/logger.interface';
import { LogBuffer } from './log-buffer';

export type LogSink = (entry: LogEntry) => void;

export interface AppLoggerOptions {
  readonly level?: LogLevel;
  readonly enabled?: boolean;
  readonly contexts?: readonly LogContext[] | null;
  readonly buffer?: ILogBuffer;
  readonly sink?: LogSink;
  readonly now?: () => Date;
  readonly idFactory?: () => string;
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: Number.POSITIVE_INFINITY,
};

export class AppLogger implements ILogger {
  private level: LogLevel;
  private enabled: boolean;
  private contextFilter: Set<LogContext> | null;
  private readonly buffer: ILogBuffer;
  private readonly sink: LogSink | undefined;
  private readonly now: () => Date;
  private readonly idFactory: () => string;

  constructor(options: AppLoggerOptions = {}) {
    this.level = options.level ?? 'info';
    this.enabled = options.enabled ?? true;
    this.contextFilter = createContextFilter(options.contexts ?? null);
    this.buffer = options.buffer ?? new LogBuffer();
    this.sink = options.sink;
    this.now = options.now ?? (() => new Date());
    this.idFactory =
      options.idFactory ?? (() => `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  }

  public debug(context: LogContext, message: string, metadata?: LogMetadata): void {
    this.log('debug', context, message, metadata);
  }

  public info(context: LogContext, message: string, metadata?: LogMetadata): void {
    this.log('info', context, message, metadata);
  }

  public warn(context: LogContext, message: string, metadata?: LogMetadata): void {
    this.log('warn', context, message, metadata);
  }

  public error(context: LogContext, message: string, metadata?: LogMetadata): void {
    this.log('error', context, message, metadata);
  }

  public log(
    level: LogEntryLevel,
    context: LogContext,
    message: string,
    metadata?: LogMetadata
  ): void {
    if (!this.shouldLog(level, context)) {
      return;
    }

    const entry: LogEntry = {
      id: this.idFactory(),
      level,
      context,
      message,
      metadata: metadata === undefined ? undefined : { ...metadata },
      createdAt: this.now().toISOString(),
    };

    this.buffer.append(entry);
    this.sink?.(entry);
  }

  public getLevel(): LogLevel {
    return this.level;
  }

  public setLevel(level: LogLevel): void {
    this.level = level;
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  public getContextFilter(): LogContext[] | null {
    return this.contextFilter === null ? null : [...this.contextFilter];
  }

  public setContextFilter(contexts: readonly LogContext[] | null): void {
    this.contextFilter = createContextFilter(contexts);
  }

  public getBufferedEntries(): LogEntry[] {
    return this.buffer.entries();
  }

  public clearBuffer(): void {
    this.buffer.clear();
  }

  private shouldLog(level: LogEntryLevel, context: LogContext): boolean {
    if (!this.enabled || this.level === 'silent') {
      return false;
    }

    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this.level]) {
      return false;
    }

    return this.contextFilter === null || this.contextFilter.has(context);
  }
}

function createContextFilter(contexts: readonly LogContext[] | null): Set<LogContext> | null {
  if (contexts === null) {
    return null;
  }

  return new Set(contexts);
}
