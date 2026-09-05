import type { BodyEventDTO } from '../shared/ipc-contracts';
import { parseBodyEventDTO } from '../shared/brain-body-ipc-validation';

/** Main-side validation and ordering boundary for the current trusted Body stream. */
export class BodyEventIngress {
  private streamId: string | null = null;
  private currentRevision = 0;
  private lastAcceptedSequence = 0;
  private activeGesture: { readonly gestureId: string; readonly pointerId: number } | null = null;

  public replaceStream(streamId: string): void {
    this.streamId = streamId;
    this.currentRevision = 0;
    this.lastAcceptedSequence = 0;
    this.activeGesture = null;
  }

  public clearStream(): void {
    this.streamId = null;
    this.currentRevision = 0;
    this.lastAcceptedSequence = 0;
    this.activeGesture = null;
  }

  public advanceRevision(revision: number): void {
    if (!Number.isSafeInteger(revision) || revision <= this.currentRevision) {
      throw new RangeError('Brain revision must increase monotonically');
    }
    this.currentRevision = revision;
  }

  public receive(payload: unknown): BodyEventDTO | null {
    const event = parseBodyEventDTO(payload);
    if (
      this.streamId === null ||
      event.streamId !== this.streamId ||
      event.sequence <= this.lastAcceptedSequence ||
      event.basedOnRevision > this.currentRevision
    ) {
      return null;
    }
    this.lastAcceptedSequence = event.sequence;
    if (event.type === 'drag_started') {
      if (this.activeGesture !== null) return null;
      this.activeGesture = {
        gestureId: event.gestureId,
        pointerId: event.pointerId,
      };
      return event;
    }
    if (event.type === 'drag_moved' || event.type === 'drag_ended') {
      if (
        this.activeGesture === null ||
        event.gestureId !== this.activeGesture.gestureId ||
        event.pointerId !== this.activeGesture.pointerId
      ) {
        return null;
      }
      if (event.type === 'drag_ended') this.activeGesture = null;
    }
    return event;
  }
}
