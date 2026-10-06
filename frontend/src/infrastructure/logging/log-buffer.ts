import type { ILogBuffer, LogEntry } from '../../application/ports/logger.interface';

const DEFAULT_LOG_BUFFER_SIZE = 100;

export class LogBuffer implements ILogBuffer {
  public readonly maxEntries: number;
  private readonly buffer: LogEntry[] = [];
  private nextIndex = 0;

  constructor(maxEntries = DEFAULT_LOG_BUFFER_SIZE) {
    this.maxEntries = Number.isFinite(maxEntries)
      ? Math.max(1, Math.floor(maxEntries))
      : DEFAULT_LOG_BUFFER_SIZE;
  }

  public append(entry: LogEntry): void {
    const bufferedEntry = cloneLogEntry(entry);

    if (this.buffer.length < this.maxEntries) {
      this.buffer.push(bufferedEntry);
      return;
    }

    this.buffer[this.nextIndex] = bufferedEntry;
    this.nextIndex = (this.nextIndex + 1) % this.maxEntries;
  }

  public entries(): LogEntry[] {
    if (this.buffer.length < this.maxEntries || this.nextIndex === 0) {
      return this.buffer.map(cloneLogEntry);
    }

    return [...this.buffer.slice(this.nextIndex), ...this.buffer.slice(0, this.nextIndex)].map(cloneLogEntry);
  }

  public clear(): void {
    this.buffer.length = 0;
    this.nextIndex = 0;
  }
}

function cloneLogEntry(entry: LogEntry): LogEntry {
  return {
    ...entry,
    metadata: cloneMetadata(entry.metadata),
  };
}

function cloneMetadata(metadata: LogEntry['metadata']): LogEntry['metadata'] {
  return metadata === undefined ? undefined : { ...metadata };
}
