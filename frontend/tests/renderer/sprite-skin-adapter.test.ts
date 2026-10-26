import { describe, expect, it, vi } from 'vitest';
import {
  AssetResolver,
  PresentationRevisionPublisher,
  SpriteSkinAdapter,
  type BodyVisualState,
  type ICharacterRenderer,
  type NormalizedSpriteAnimationDef,
  type NormalizedSpriteManifest,
  type RenderPresentationState,
  type SkinAnimationFrameScheduler,
} from '../../src/renderer/render-engine';
import type { BrainVisualIntentKindDTO } from '../../src/shared/ipc-contracts';
import { createAnimationPreviewState } from '../../src/renderer/render-engine/animation-preview';
import { applyLocalTerminalState } from '../../src/renderer/render-engine/local-terminal-state';

const manifest: NormalizedSpriteManifest = {
  schemaVersion: 1,
  animations: {
    body_idle: animation('body_idle', 'body/idle', 'body', true),
    body_walk: animation('body_walk', 'body/walk', 'body', false),
    body_run: animation('body_run', 'body/run', 'body', false),
    body_climb_wall: animation('body_climb_wall', 'body/climb', 'body', false),
    body_fall: animation('body_fall', 'body/fall', 'body', false),
    body_sleep: animation('body_sleep', 'body/sleep', 'body', false),
    body_petting: animation('body_petting', 'body/petting', 'body', false),
    face_happy: animation('face_happy', 'face/happy', 'face', false),
    face_gaze: animation('face_gaze', 'face/gaze', 'face', false),
  },
};

function animation(
  key: string,
  category: `body/${string}` | `face/${string}`,
  layer: 'body' | 'face',
  overlay: boolean
): NormalizedSpriteAnimationDef {
  const pivot = layer === 'body' ? { x: 256, y: 460 } : { x: 256, y: 180 };
  return {
    key,
    category,
    layer,
    frames: [0, 1, 2, 3].map((index) => ({
      source: `${key}_${index}.png`,
      durationMs: 100,
      pivot,
    })),
    framesCount: 4,
    fps: 10,
    pivot,
    ...(layer === 'body'
      ? {
          faceOverlay: overlay
            ? {
                mode: 'overlay' as const,
                allowedFaceKeys: ['face_happy', 'face_gaze'],
                fallback: 'face_happy' as const,
                anchor: 'face' as const,
              }
            : { mode: 'baked_in' as const, fallback: 'none' as const },
          defaultAnchors: { face: { x: 256, y: 180 } },
        }
      : {}),
    tags: [],
  };
}

function visualState(
  revision: number,
  kind: BrainVisualIntentKindDTO = 'walk',
  options: {
    readonly streamId?: string;
    readonly episodeId?: string;
    readonly visualAgeMs?: number;
    readonly expressionHint?: BodyVisualState['visualIntent']['expressionHint'];
    readonly pupilOffset?: { readonly x: number; readonly y: number };
    readonly flipX?: boolean;
    readonly scaleX?: number;
    readonly scaleY?: number;
    readonly rotationDeg?: number;
  } = {}
): BodyVisualState {
  return {
    streamId: options.streamId ?? 'stream-1',
    revision,
    visualIntent: {
      episodeId: options.episodeId ?? 'episode-1',
      episodeSequence: Number((options.episodeId ?? 'episode-1').split('-').at(-1)) || revision,
      episodeStartedAtMs: 0,
      kind,
      category: kind === 'idle_blink' ? 'idle' : kind.startsWith('sleep') ? 'sleep' : 'movement',
      priority: 'normal',
      interrupt: 'yes',
      loop: 'until_replaced',
      emotionalTone: 'neutral',
      ...(options.expressionHint === undefined ? {} : { expressionHint: options.expressionHint }),
    },
    visualAgeMs: options.visualAgeMs ?? 0,
    reflex: {
      pupilOffset: options.pupilOffset ?? { x: 0, y: 0 },
      transform: {
        flipX: options.flipX ?? false,
        scaleX: options.scaleX ?? 1,
        scaleY: options.scaleY ?? 1,
        rotationDeg: options.rotationDeg ?? 0,
      },
    },
  };
}

class TestScheduler implements SkinAnimationFrameScheduler {
  private nextId = 0;
  private readonly callbacks = new Map<number, (now: number) => void>();
  public readonly cancelled: number[] = [];

  public request(callback: (now: number) => void): number {
    const id = ++this.nextId;
    this.callbacks.set(id, callback);
    return id;
  }

  public cancel(frameId: number): void {
    this.cancelled.push(frameId);
    this.callbacks.delete(frameId);
  }

  public run(now: number): void {
    const entry = this.callbacks.entries().next().value as
      | [number, (time: number) => void]
      | undefined;
    if (entry === undefined) throw new Error('No scheduled animation frame.');
    this.callbacks.delete(entry[0]);
    entry[1](now);
  }

  public pendingCount(): number {
    return this.callbacks.size;
  }
}

function fixture() {
  const scheduler = new TestScheduler();
  const states: RenderPresentationState[] = [];
  const destroyed = vi.fn();
  const createRenderer = vi.fn((): ICharacterRenderer => ({
    render: (state) => states.push(state),
    destroy: destroyed,
  }));
  const adapter = new SpriteSkinAdapter({
    resolver: new AssetResolver(manifest),
    createRenderer,
    scheduler,
  });
  return { adapter, scheduler, states, destroyed, createRenderer };
}

describe('Renderer: SpriteSkinAdapter', () => {
  it('scales walking cadence with velocity and resumes after stopping', () => {
    const kind = 'walk';
    const referenceSpeed = 90;
    const { adapter, scheduler, states } = fixture();
    const moving = (revision: number, speed: number): BodyVisualState => ({
      ...visualState(revision, kind), motionVelocityPxPerSec: { x: speed, y: 0 },
    });
    adapter.init(); adapter.update(moving(1, referenceSpeed / 2));
    scheduler.run(0); scheduler.run(100);
    expect(states.at(-1)?.playback?.frameIndex).toBe(0);
    scheduler.run(200); expect(states.at(-1)?.playback?.frameIndex).toBe(1);
    adapter.update(moving(2, 0)); scheduler.run(1200);
    expect(states.at(-1)?.playback?.frameIndex).toBe(0);
    adapter.update(moving(3, referenceSpeed)); scheduler.run(1300);
    expect(states.at(-1)?.playback?.frameIndex).toBe(2);
    adapter.destroy();
  });
  it('restarts a completed missing-art fallback as a live local idle loop', () => {
    const f = fixture();
    f.adapter.init();
    const body = visualState(1, 'wave');
    const finite = { ...body, visualIntent: { ...body.visualIntent, loop: 'none' as const } };
    f.adapter.update(applyLocalTerminalState(finite, null));
    f.scheduler.run(0);
    f.scheduler.run(400);
    expect(f.states.at(-1)?.layers[0]?.frame?.source).toBe('body_idle_3.png');
    f.adapter.update(applyLocalTerminalState(finite, 'idle_blink'));
    f.scheduler.run(500);
    expect(f.states.at(-1)?.layers[0]?.frame?.source).toBe('body_idle_1.png');
    f.adapter.destroy();
  });
  it('previews an exact clip from frame zero independently of Brain age and episode changes', () => {
    const scheduler = new TestScheduler();
    const states: RenderPresentationState[] = [];
    const resolver = new AssetResolver(manifest);
    const selection = { bodyKey: 'body_run', faceKey: 'face_happy', replayToken: 1, loop: false };
    const adapter = new SpriteSkinAdapter({
      resolver: { resolve: () => resolver.resolveDebugSelection(selection.bodyKey, selection.faceKey) },
      createRenderer: () => ({ render: state => states.push(state), destroy: () => undefined }),
      scheduler,
    });
    adapter.init();
    const brain = visualState(1, 'sleep_loop', { visualAgeMs: 60_000 });
    adapter.update(createAnimationPreviewState(brain, selection));
    expect(states.at(-1)?.layers[0]?.frame?.source).toBe('body_run_0.png');
    scheduler.run(1000);
    scheduler.run(1150);
    expect(states.at(-1)?.layers[0]?.frame?.source).toBe('body_run_1.png');
    adapter.update(createAnimationPreviewState(visualState(2, 'idle_blink', {
      episodeId: 'new-brain-episode', visualAgeMs: 10_000,
    }), selection));
    expect(states.at(-1)?.layers[0]?.frame?.source).toBe('body_run_1.png');
    scheduler.run(1600);
    expect(states.at(-1)?.layers[0]?.frame?.source).toBe('body_run_3.png');
    adapter.update(createAnimationPreviewState(visualState(3), { ...selection, replayToken: 2, loop: true }));
    expect(states.at(-1)?.layers[0]?.frame?.source).toBe('body_run_0.png');
    scheduler.run(2050);
    expect(states.at(-1)?.layers[0]?.frame?.source).toBe('body_run_0.png');
    expect(brain.visualAgeMs).toBe(60_000);
    expect(brain.visualIntent.episodeId).toBe('episode-1');
    adapter.destroy();
    expect(scheduler.pendingCount()).toBe(0);
  });

  it('suppresses unchanged frames, publishes changed frames, and applies reflexes without replay', () => {
    const { adapter, scheduler, states } = fixture();
    adapter.init();
    adapter.update(visualState(1));
    expect(states).toHaveLength(1);

    scheduler.run(1_000);
    scheduler.run(1_050);
    expect(states).toHaveLength(1);

    adapter.update(visualState(2));
    expect(states).toHaveLength(1);

    adapter.update(visualState(3, 'walk', {
      flipX: true,
      scaleX: 1.08,
      scaleY: 0.92,
      rotationDeg: 12,
    }));
    expect(states).toHaveLength(2);
    expect(states.at(-1)?.transform).toMatchObject({
      flipX: true,
      scaleX: 1.08,
      scaleY: 0.92,
      rotationDeg: 12,
    });

    adapter.update(visualState(2, 'walk', { flipX: false }));
    expect(states).toHaveLength(2);

    scheduler.run(1_110);
    expect(states).toHaveLength(3);
    expect(states.at(-1)?.layers[0]).toMatchObject({ frame: { source: 'body_walk_1.png' } });
  });

  it('starts an episode at visualAgeMs and replays only for a new stream/episode key', () => {
    const { adapter, scheduler, states, destroyed, createRenderer } = fixture();
    adapter.init();
    adapter.update(visualState(1, 'walk', { visualAgeMs: 150 }));
    expect(states).toHaveLength(1);
    expect(states.at(-1)?.layers[0]).toMatchObject({ frame: { source: 'body_walk_1.png' } });

    scheduler.run(1_000);
    scheduler.run(1_050);
    expect(states.at(-1)?.layers[0]).toMatchObject({ frame: { source: 'body_walk_2.png' } });

    adapter.update(visualState(2, 'walk', { visualAgeMs: 0 }));
    expect(states.at(-1)?.layers[0]).toMatchObject({ frame: { source: 'body_walk_2.png' } });

    adapter.update(visualState(3, 'walk', { episodeId: 'episode-2' }));
    expect(states.at(-1)?.layers[0]).toMatchObject({ frame: { source: 'body_walk_0.png' } });

    adapter.update(visualState(1, 'walk', { streamId: 'stream-2', episodeId: 'episode-1' }));
    expect(createRenderer).toHaveBeenCalledTimes(2);
    expect(destroyed).toHaveBeenCalledOnce();
    expect(states.at(-1)?.layers[0]).toMatchObject({ frame: { source: 'body_walk_0.png' } });
  });

  it('keeps init idempotent and releases RAF, callbacks, player and renderer on destroy', () => {
    const { adapter, scheduler, states, destroyed, createRenderer } = fixture();
    adapter.init();
    adapter.init();
    adapter.update(visualState(1));

    expect(createRenderer).toHaveBeenCalledOnce();
    expect(scheduler.pendingCount()).toBe(1);
    adapter.destroy();
    adapter.destroy();

    expect(destroyed).toHaveBeenCalledOnce();
    expect(scheduler.pendingCount()).toBe(0);
    expect(scheduler.cancelled).toHaveLength(1);
    adapter.update(visualState(2, 'run', { episodeId: 'episode-2' }));
    expect(states).toHaveLength(1);
  });
});

describe('Renderer: PresentationRevisionPublisher', () => {
  it('uses shallow frame identity instead of full-tree serialization', () => {
    const render = vi.fn();
    const destroy = vi.fn();
    const publisher = new PresentationRevisionPublisher({ render, destroy });
    const frame = { source: 'body_walk_0.png' };
    const state: RenderPresentationState = {
      viewport: { width: 512, height: 512 },
      rootPivot: { x: 256, y: 460 },
      transform: { flipX: false, scale: 1 },
      layers: [{
        id: 'base_body', category: 'body', zIndex: 10, animationKey: 'body_walk',
        pivot: { x: 256, y: 460 }, offset: { x: 0, y: 0 }, opacity: 1,
        blendMode: 'normal', visible: true, frame,
      }],
    };

    publisher.render(state);
    publisher.render({ ...state, layers: [{ ...state.layers[0]!, frame }] });
    publisher.render({
      ...state,
      layers: [{ ...state.layers[0]!, frame: { source: 'body_walk_1.png' } }],
    });

    expect(render).toHaveBeenCalledTimes(2);
    expect(publisher.getRevision()).toBe(2);
    publisher.destroy();
    expect(destroy).toHaveBeenCalledOnce();
  });
});
