import { describe, expect, it, vi } from 'vitest';
import {
  CURSOR_OBSERVATION_MIN_INTERVAL_MS,
  CursorObservationRefresh,
  isCursorObservationCompatible,
  registerCursorObservationListeners,
  type CursorObservationScheduler,
  type VisibilityListenerTarget,
} from '../../src/renderer/body-ui-runtime';

class Scheduler implements CursorObservationScheduler {
  public nowMs = 0;
  public delays: number[] = [];
  private nextId = 0;
  private readonly callbacks = new Map<
    number,
    { readonly dueAtMs: number; readonly callback: () => void }
  >();

  public now(): number {
    return this.nowMs;
  }

  public setTimeout(callback: () => void, delayMs: number): unknown {
    const id = ++this.nextId;
    this.callbacks.set(id, { dueAtMs: this.nowMs + delayMs, callback });
    this.delays.push(delayMs);
    return id;
  }

  public clearTimeout(handle: unknown): void {
    this.callbacks.delete(handle as number);
  }

  public runNext(): void {
    const entry = [...this.callbacks.entries()]
      .sort((left, right) => left[1].dueAtMs - right[1].dueAtMs)[0];
    if (entry === undefined) return;
    this.callbacks.delete(entry[0]);
    this.nowMs = entry[1].dueAtMs;
    entry[1].callback();
  }

  public size(): number {
    return this.callbacks.size;
  }
}

class ListenerFixture implements VisibilityListenerTarget {
  public hidden = false;
  private readonly listeners = new Map<string, Set<(event: never) => void>>();

  public addEventListener(type: string, listener: (event: never) => void): void {
    const current = this.listeners.get(type) ?? new Set();
    current.add(listener);
    this.listeners.set(type, current);
  }

  public removeEventListener(type: string, listener: (event: never) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  public dispatch(type: string, event: unknown = undefined): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event as never);
  }

  public count(): number {
    return [...this.listeners.values()].reduce((sum, listeners) => sum + listeners.size, 0);
  }
}

describe('Renderer: cursor observation refresh', () => {
  it('emits a leading sample, refreshes only the latest at 10 Hz, and cleans up', () => {
    const scheduler = new Scheduler();
    const emit = vi.fn();
    const refresh = new CursorObservationRefresh(emit, scheduler);

    refresh.observe({ x: 10, y: 20 });
    refresh.observe({ x: 30, y: 40 });
    expect(emit.mock.calls).toEqual([[{ x: 10, y: 20 }]]);
    expect(scheduler.delays).toEqual([CURSOR_OBSERVATION_MIN_INTERVAL_MS]);

    scheduler.runNext();
    expect(emit.mock.calls).toEqual([[{ x: 10, y: 20 }], [{ x: 30, y: 40 }]]);
    expect(scheduler.size()).toBe(1);

    refresh.clear();
    expect(scheduler.size()).toBe(0);
    refresh.observe({ x: 50, y: 60 });
    expect(emit).toHaveBeenCalledTimes(2);
    scheduler.runNext();
    expect(emit).toHaveBeenLastCalledWith({ x: 50, y: 60 });
    refresh.destroy();
    expect(scheduler.size()).toBe(0);
    refresh.observe({ x: 70, y: 80 });
    expect(emit).toHaveBeenCalledTimes(3);
  });

  it('preserves the emission deadline across rapid clear and re-entry', () => {
    const scheduler = new Scheduler();
    const emit = vi.fn();
    const refresh = new CursorObservationRefresh(emit, scheduler);

    refresh.observe({ x: 1, y: 1 });
    scheduler.nowMs = 10;
    refresh.clear();
    refresh.observe({ x: 2, y: 2 });
    scheduler.nowMs = 20;
    refresh.clear();
    refresh.observe({ x: 3, y: 3 });

    expect(emit.mock.calls).toEqual([[{ x: 1, y: 1 }]]);
    expect(scheduler.delays).toEqual([100, 90, 80]);
    scheduler.runNext();
    expect(emit.mock.calls).toEqual([[{ x: 1, y: 1 }], [{ x: 3, y: 3 }]]);
  });

  it.each([
    ['active Activity', { activityId: 'explore' }],
    ['click reaction', { visualKind: 'happy_reaction' }],
    ['drag', { dragging: true }],
    ['forced motion', { motionPhase: 'airborne' as const }],
    ['menu', { menuOpen: true }],
    ['autonomy disabled', { autonomyEnabled: false }],
  ])('suppresses capture during %s', (_label, override) => {
    expect(isCursorObservationCompatible({
      autonomyEnabled: true,
      menuOpen: false,
      dragging: false,
      motionPhase: 'grounded',
      activityId: null,
      visualKind: 'idle_blink',
      ...override,
    })).toBe(false);
  });

  it('keeps gaze capture enabled for the Observe Cursor Activity itself', () => {
    expect(isCursorObservationCompatible({
      autonomyEnabled: true,
      menuOpen: false,
      dragging: false,
      motionPhase: 'grounded',
      activityId: 'observe_cursor',
      visualKind: 'wave',
    })).toBe(true);
  });

  it('clears on pointer loss/hidden document and removes every listener on teardown', () => {
    const pointer = new ListenerFixture();
    const visibility = new ListenerFixture();
    const move = vi.fn();
    const unavailable = vi.fn();
    const remove = registerCursorObservationListeners(pointer, visibility, {
      move,
      unavailable,
    });

    pointer.dispatch('mousemove', { screenX: 10, screenY: 20 });
    pointer.dispatch('pointerleave');
    pointer.dispatch('pointercancel');
    visibility.dispatch('visibilitychange');
    visibility.hidden = true;
    visibility.dispatch('visibilitychange');
    expect(move).toHaveBeenCalledWith({ screenX: 10, screenY: 20 });
    expect(unavailable).toHaveBeenCalledTimes(3);

    remove();
    expect(pointer.count()).toBe(0);
    expect(visibility.count()).toBe(0);
    pointer.dispatch('mousemove', { screenX: 30, screenY: 40 });
    expect(move).toHaveBeenCalledOnce();
  });
});
