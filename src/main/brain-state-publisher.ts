import type { BrainStateDTO } from '../shared/ipc-contracts';
import { parseBrainStateDTO } from '../shared/brain-body-ipc-validation';

export interface BrainStateRevisionSink {
  replaceStream(streamId: string): void;
  clearStream(): void;
  advanceRevision(revision: number): void;
}

export interface BrainStateSnapshotMeta {
  readonly streamId: string;
  readonly revision: number;
  readonly sampledAtMs: number;
}

export interface BrainStatePublisherOptions {
  readonly now: () => number;
  readonly createStreamId: () => string;
  readonly createSnapshot: (meta: BrainStateSnapshotMeta) => unknown;
  readonly deliver: (state: BrainStateDTO) => void | Promise<void>;
  readonly revisionSink: BrainStateRevisionSink;
  readonly scheduleFlush?: (callback: () => void) => void;
  readonly onDeliveryError?: (error: unknown) => void;
}

interface PendingSnapshot {
  readonly state: BrainStateDTO;
  readonly projectionSignature: string;
  readonly semanticSignature: string;
  readonly motionOnly: boolean;
}

interface InFlightSnapshot extends PendingSnapshot {
  readonly generation: number;
}

/**
 * Serializes committed Brain transactions and applies latest-wins only to
 * pending snapshots whose sole change is Motion state.
 */
export class BrainStatePublisher {
  private readonly scheduleFlush: (callback: () => void) => void;
  private streamId: string | null = null;
  private generation = 0;
  private nextRevision = 0;
  private transactionDepth = 0;
  private transactionDirty = false;
  private lastObservedProjectionSignature: string | null = null;
  private lastObservedSemanticSignature: string | null = null;
  private lastDeliveredProjectionSignature: string | null = null;
  private readonly pending: PendingSnapshot[] = [];
  private inFlight: InFlightSnapshot | null = null;
  private flushScheduled = false;

  constructor(private readonly options: BrainStatePublisherOptions) {
    this.scheduleFlush = options.scheduleFlush ?? queueMicrotask;
  }

  public replaceStream(): string {
    const streamId = this.options.createStreamId();
    this.generation += 1;
    this.streamId = streamId;
    this.nextRevision = 0;
    this.transactionDepth = 0;
    this.transactionDirty = false;
    this.lastObservedProjectionSignature = null;
    this.lastObservedSemanticSignature = null;
    this.lastDeliveredProjectionSignature = null;
    this.pending.length = 0;
    this.inFlight = null;
    this.flushScheduled = false;
    this.options.revisionSink.replaceStream(streamId);
    this.capture(true);
    return streamId;
  }

  public clearStream(): void {
    this.generation += 1;
    this.streamId = null;
    this.nextRevision = 0;
    this.transactionDepth = 0;
    this.transactionDirty = false;
    this.lastObservedProjectionSignature = null;
    this.lastObservedSemanticSignature = null;
    this.lastDeliveredProjectionSignature = null;
    this.pending.length = 0;
    this.inFlight = null;
    this.flushScheduled = false;
    this.options.revisionSink.clearStream();
  }

  public beginTransaction(): void {
    this.transactionDepth += 1;
  }

  public commitTransaction(): void {
    if (this.transactionDepth === 0) {
      throw new Error('Cannot commit a Brain transaction that was not started');
    }
    this.transactionDepth -= 1;
    if (this.transactionDepth !== 0 || !this.transactionDirty) return;
    this.transactionDirty = false;
    this.capture(false);
  }

  public requestCommit(): void {
    if (this.streamId === null) return;
    if (this.transactionDepth > 0) {
      this.transactionDirty = true;
      return;
    }
    this.capture(false);
  }

  private capture(force: boolean): void {
    const streamId = this.streamId;
    if (streamId === null) return;
    const revision = this.nextRevision + 1;
    if (!Number.isSafeInteger(revision)) {
      throw new RangeError('Brain revision exceeds the safe integer range');
    }
    const state = parseBrainStateDTO(this.options.createSnapshot({
      streamId,
      revision,
      sampledAtMs: this.options.now(),
    }));
    if (state.streamId !== streamId || state.revision !== revision) {
      throw new TypeError('Brain snapshot metadata does not match the active stream');
    }
    const projectionSignature = createProjectionSignature(state);
    if (!force && projectionSignature === this.lastObservedProjectionSignature) return;

    const semanticSignature = createSemanticSignature(state);
    const motionOnly =
      this.lastObservedSemanticSignature !== null &&
      semanticSignature === this.lastObservedSemanticSignature;
    const snapshot: PendingSnapshot = {
      state,
      projectionSignature,
      semanticSignature,
      motionOnly,
    };
    this.nextRevision = revision;
    this.lastObservedProjectionSignature = projectionSignature;
    this.lastObservedSemanticSignature = semanticSignature;

    const tail = this.pending[this.pending.length - 1];
    if (motionOnly && tail?.motionOnly === true) {
      this.pending[this.pending.length - 1] = snapshot;
    } else {
      this.pending.push(snapshot);
    }
    this.requestFlush();
  }

  private requestFlush(): void {
    if (
      this.flushScheduled ||
      this.inFlight !== null ||
      this.pending.length === 0 ||
      this.streamId === null
    ) {
      return;
    }
    const generation = this.generation;
    this.flushScheduled = true;
    this.scheduleFlush(() => {
      if (generation !== this.generation) return;
      this.flushScheduled = false;
      this.flushNext();
    });
  }

  private flushNext(): void {
    if (this.inFlight !== null || this.streamId === null) return;
    const snapshot = this.pending.shift();
    if (snapshot === undefined) return;
    const inFlight: InFlightSnapshot = { ...snapshot, generation: this.generation };
    this.inFlight = inFlight;

    let delivery: void | Promise<void>;
    try {
      delivery = this.options.deliver(snapshot.state);
    } catch (error) {
      this.finishDelivery(inFlight, error);
      return;
    }
    void Promise.resolve(delivery).then(
      () => this.finishDelivery(inFlight),
      (error: unknown) => this.finishDelivery(inFlight, error)
    );
  }

  private finishDelivery(snapshot: InFlightSnapshot, error?: unknown): void {
    if (snapshot.generation !== this.generation || this.inFlight !== snapshot) return;
    this.inFlight = null;
    if (error === undefined) {
      this.lastDeliveredProjectionSignature = snapshot.projectionSignature;
      this.options.revisionSink.advanceRevision(snapshot.state.revision);
      while (
        this.pending[0]?.motionOnly === true &&
        this.pending[0].projectionSignature === this.lastDeliveredProjectionSignature
      ) {
        this.pending.shift();
      }
    } else {
      this.options.onDeliveryError?.(error);
    }
    this.requestFlush();
  }
}

function createProjectionSignature(state: BrainStateDTO): string {
  return JSON.stringify({
    character: state.character,
    activity: state.activity,
    motion: state.motion,
    visualIntent: state.visualIntent,
  });
}

function createSemanticSignature(state: BrainStateDTO): string {
  return JSON.stringify({
    character: state.character,
    activity: state.activity,
    positionAuthority: state.motion.positionAuthority,
    visualIntent: state.visualIntent,
  });
}
