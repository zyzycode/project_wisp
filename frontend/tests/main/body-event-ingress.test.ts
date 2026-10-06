import { describe, expect, it } from 'vitest';
import { BodyEventIngress } from '../../src/main/body-event-ingress';

function interaction(sequence: number, basedOnRevision = 1, streamId = 'stream-1') {
  return {
    streamId,
    sequence,
    basedOnRevision,
    observedAtMs: sequence * 10,
    type: 'interaction' as const,
    interaction: 'click' as const,
  };
}

function dragStarted(
  sequence: number,
  streamId = 'stream-1',
  gestureId = 'gesture-1',
  pointerId = 7
) {
  return {
    streamId,
    sequence,
    basedOnRevision: 1,
    observedAtMs: sequence * 10,
    type: 'drag_started' as const,
    gestureId,
    pointerId,
    screenPosition: { x: sequence, y: sequence + 1 },
  };
}

function dragMoved(
  sequence: number,
  streamId = 'stream-1',
  gestureId = 'gesture-1',
  pointerId = 7
) {
  return {
    ...dragStarted(sequence, streamId, gestureId, pointerId),
    type: 'drag_moved' as const,
  };
}

function dragEnded(
  sequence: number,
  streamId = 'stream-1',
  gestureId = 'gesture-1',
  pointerId = 7
) {
  return {
    ...dragStarted(sequence, streamId, gestureId, pointerId),
    type: 'drag_ended' as const,
    cancelled: false,
  };
}

describe('Main: Body event ingress', () => {
  it('accepts sequence gaps but drops duplicate, foreign, and future events', () => {
    const ingress = new BodyEventIngress();
    ingress.replaceStream('stream-1');
    ingress.advanceRevision(2);

    expect(ingress.receive(interaction(2))).toEqual(interaction(2));
    expect(ingress.receive(interaction(2))).toBeNull();
    expect(ingress.receive(interaction(3, 1, 'foreign'))).toBeNull();
    expect(ingress.receive(interaction(4, 3))).toBeNull();
    expect(ingress.receive(interaction(5, 1))).toEqual(interaction(5, 1));
  });

  it('resets ordering on stream replacement and rejects malformed payloads before state', () => {
    const ingress = new BodyEventIngress();
    ingress.replaceStream('stream-1');
    ingress.advanceRevision(1);
    expect(ingress.receive(interaction(4))).not.toBeNull();

    ingress.replaceStream('stream-2');
    ingress.advanceRevision(1);
    expect(ingress.receive(interaction(1, 1, 'stream-2'))).not.toBeNull();
    expect(() => ingress.receive({ ...interaction(2, 1, 'stream-2'), extra: true }))
      .toThrow(TypeError);
  });

  it('enforces one causal drag lifecycle for the active gesture and pointer', () => {
    const ingress = new BodyEventIngress();
    ingress.replaceStream('stream-1');
    ingress.advanceRevision(1);

    expect(ingress.receive(dragMoved(1))).toBeNull();
    expect(ingress.receive(dragEnded(2))).toBeNull();
    expect(ingress.receive(dragStarted(3))).toEqual(dragStarted(3));
    expect(ingress.receive(dragStarted(4, 'stream-1', 'gesture-2'))).toBeNull();
    expect(ingress.receive(dragMoved(5, 'stream-1', 'gesture-2'))).toBeNull();
    expect(ingress.receive(dragEnded(6, 'stream-1', 'gesture-1', 8))).toBeNull();
    expect(ingress.receive(dragMoved(7))).toEqual(dragMoved(7));
    expect(ingress.receive(dragEnded(8))).toEqual(dragEnded(8));
    expect(ingress.receive(dragEnded(9))).toBeNull();
    expect(ingress.receive(dragStarted(10, 'stream-1', 'gesture-2')))
      .toEqual(dragStarted(10, 'stream-1', 'gesture-2'));
  });

  it('clears the active gesture when the trusted stream is replaced', () => {
    const ingress = new BodyEventIngress();
    ingress.replaceStream('stream-1');
    ingress.advanceRevision(1);
    expect(ingress.receive(dragStarted(1))).not.toBeNull();

    ingress.replaceStream('stream-2');
    ingress.advanceRevision(1);
    expect(ingress.receive(dragMoved(2))).toBeNull();
    expect(ingress.receive(dragMoved(1, 'stream-2'))).toBeNull();
    expect(ingress.receive(dragStarted(2, 'stream-2')))
      .toEqual(dragStarted(2, 'stream-2'));
  });
});
