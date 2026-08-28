import { describe, it, expect } from 'vitest';
import { AppLogger } from '../../src/infrastructure/logging';
import { LogBuffer } from '../../src/infrastructure/logging/log-buffer';
import type { LogEntry, LogEntryLevel } from '../../src/application/ports/logger.interface';

function createLogger(options: {
  level?: LogEntryLevel | 'silent';
  buffer?: LogBuffer;
  sinkEntries?: LogEntry[];
  contexts?: Array<LogEntry['context']>;
} = {}): AppLogger {
  let nextId = 0;

  return new AppLogger({
    level: options.level,
    buffer: options.buffer,
    contexts: options.contexts ?? null,
    now: () => new Date('2026-08-28T00:00:00.000Z'),
    idFactory: () => `log-${++nextId}`,
    sink: options.sinkEntries === undefined ? undefined : (entry) => options.sinkEntries?.push(entry),
  });
}

describe('Infrastructure: structured logging', () => {
  it('buffers structured log entries and forwards accepted entries to the sink', () => {
    const sinkEntries: LogEntry[] = [];
    const logger = createLogger({ level: 'debug', sinkEntries });

    logger.info('AIProvider', 'provider ready', { provider: 'mock' });

    expect(logger.getBufferedEntries()).toEqual([
      {
        id: 'log-1',
        level: 'info',
        context: 'AIProvider',
        message: 'provider ready',
        metadata: { provider: 'mock' },
        createdAt: '2026-08-28T00:00:00.000Z',
      },
    ]);
    expect(sinkEntries).toEqual(logger.getBufferedEntries());
  });

  it('filters entries below the configured level', () => {
    const sinkEntries: LogEntry[] = [];
    const logger = createLogger({ level: 'warn', sinkEntries });

    logger.debug('FSM', 'ignored debug');
    logger.info('FSM', 'ignored info');
    logger.warn('FSM', 'accepted warn');
    logger.error('FSM', 'accepted error');

    expect(logger.getBufferedEntries().map((entry) => entry.level)).toEqual(['warn', 'error']);
    expect(sinkEntries.map((entry) => entry.message)).toEqual(['accepted warn', 'accepted error']);
  });

  it('filters entries by context when a context filter is configured', () => {
    const logger = createLogger({ level: 'debug', contexts: ['FSM', 'AIProvider'] });

    logger.debug('FSM', 'state transition');
    logger.debug('Needs', 'need drift');
    logger.info('AIProvider', 'request started');

    expect(logger.getBufferedEntries().map((entry) => entry.context)).toEqual([
      'FSM',
      'AIProvider',
    ]);

    logger.setContextFilter(['Needs']);
    logger.warn('FSM', 'ignored after filter change');
    logger.warn('Needs', 'accepted after filter change');

    expect(logger.getBufferedEntries().map((entry) => entry.message)).toEqual([
      'state transition',
      'request started',
      'accepted after filter change',
    ]);
  });

  it('supports full shutdown via silent level and enabled flag', () => {
    const sinkEntries: LogEntry[] = [];
    const logger = createLogger({ level: 'silent', sinkEntries });

    logger.error('IPC', 'ignored by silent');
    expect(logger.getBufferedEntries()).toEqual([]);
    expect(sinkEntries).toEqual([]);

    logger.setLevel('debug');
    logger.setEnabled(false);
    logger.error('IPC', 'ignored while disabled');
    expect(logger.getBufferedEntries()).toEqual([]);

    logger.setEnabled(true);
    logger.error('IPC', 'accepted after re-enable');
    expect(logger.getBufferedEntries().map((entry) => entry.message)).toEqual([
      'accepted after re-enable',
    ]);
  });

  it('keeps only the latest entries in insertion order', () => {
    const buffer = new LogBuffer(3);
    const logger = createLogger({ level: 'debug', buffer });

    logger.debug('FSM', 'one');
    logger.info('CharacterEngine', 'two');
    logger.warn('Needs', 'three');
    logger.error('IPC', 'four');
    logger.info('Autonomy', 'five');

    expect(buffer.maxEntries).toBe(3);
    expect(buffer.entries().map((entry) => entry.message)).toEqual(['three', 'four', 'five']);
    expect(logger.getBufferedEntries().map((entry) => entry.id)).toEqual(['log-3', 'log-4', 'log-5']);
  });

  it('uses a 100-entry ring buffer by default', () => {
    const logger = createLogger({ level: 'debug' });

    for (let index = 1; index <= 101; index++) {
      logger.info('Autonomy', `entry ${index}`);
    }

    const entries = logger.getBufferedEntries();
    expect(entries).toHaveLength(100);
    expect(entries[0]?.message).toBe('entry 2');
    expect(entries[99]?.message).toBe('entry 101');
  });

  it('falls back to the default bounded capacity for non-finite input', () => {
    const buffer = new LogBuffer(Infinity);

    for (let index = 1; index <= 101; index++) {
      buffer.append({
        id: `log-${index}`,
        level: 'info',
        context: 'Autonomy',
        message: `entry ${index}`,
        createdAt: '2026-08-28T00:00:00.000Z',
      });
    }

    expect(buffer.maxEntries).toBe(100);
    expect(buffer.entries()).toHaveLength(100);
    expect(buffer.entries()[0]?.message).toBe('entry 2');
  });

  it('returns defensive copies from the buffer', () => {
    const logger = createLogger({ level: 'debug' });

    logger.info('RenderEngine', 'frame rendered', { frame: 1 });
    const entries = logger.getBufferedEntries();
    const mutableEntry = entries[0]! as {
      message: string;
      metadata?: Record<string, unknown>;
    };
    mutableEntry.message = 'mutated';
    mutableEntry.metadata = { frame: 999 };

    expect(logger.getBufferedEntries()[0]).toMatchObject({
      message: 'frame rendered',
      metadata: { frame: 1 },
    });
  });
});
