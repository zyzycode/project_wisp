import { describe, expect, it, vi } from 'vitest';
import { AnimationStateMachine } from '../../src/domain/animation';
import { AnimationPlayer, type ICharacterRenderer, type RenderPresentationState, type ResolvedAnimationClip } from '../../src/renderer/render-engine';

function createClip(overrides: Partial<ResolvedAnimationClip> = {}): ResolvedAnimationClip {
  return {
    key: 'body_walk',
    viewport: { width: 512, height: 512 },
    rootPivot: { x: 256, y: 460 },
    transform: { flipX: false, scale: 1 },
    body: {
      id: 'base_body',
      category: 'body',
      animationKey: 'body_walk',
      zIndex: 10,
      fps: 8,
      frames: [0, 1, 2, 3].map((index) => ({ source: `walk_${index}.png` })),
    },
    ...overrides,
  };
}

function createRenderer(): { renderer: ICharacterRenderer; states: RenderPresentationState[] } {
  const states: RenderPresentationState[] = [];
  return {
    renderer: { render: (state): void => { states.push(state); }, destroy: (): void => undefined },
    states,
  };
}

function bodySource(state: RenderPresentationState | undefined): string | undefined {
  return layerSource(state?.layers, 0);
}

function layerSource(stateLayers: RenderPresentationState['layers'] | undefined, index: number): string | undefined {
  const layer = stateLayers?.[index];
  return layer?.visible ? layer.frame.source : undefined;
}

describe('Renderer: AnimationPlayer', () => {
  it('emits the initial walk frame and advances all four frames deterministically', () => {
    const { renderer, states } = createRenderer();
    const player = new AnimationPlayer(renderer);
    player.play(createClip(), { type: 'until_replaced' });
    expect(bodySource(player.getPresentationState())).toBe('walk_0.png');

    player.tick(125);
    expect(bodySource(player.getPresentationState())).toBe('walk_1.png');
    player.tick(125);
    expect(bodySource(player.getPresentationState())).toBe('walk_2.png');
    player.tick(125);
    expect(bodySource(player.getPresentationState())).toBe('walk_3.png');
    player.tick(125);
    expect(bodySource(player.getPresentationState())).toBe('walk_0.png');
    expect(states).toHaveLength(5);
  });

  it('loops an eight-frame manifest track through its final frame back to zero', () => {
    const { renderer } = createRenderer();
    const player = new AnimationPlayer(renderer);
    const clip = createClip({
      key: 'body_idle',
      body: {
        ...createClip().body,
        animationKey: 'body_idle',
        frames: Array.from({ length: 8 }, (_, index) => ({ source: `idle_${index}.png` })),
      },
    });
    player.play(clip, { type: 'until_replaced' });
    player.tick(7 * 125);
    expect(bodySource(player.getPresentationState())).toBe('idle_7.png');
    player.tick(125);
    expect(bodySource(player.getPresentationState())).toBe('idle_0.png');
  });

  it('uses per-frame timings and resolves large deltas without stepping frame by frame', () => {
    const { renderer } = createRenderer();
    const player = new AnimationPlayer(renderer);
    const clip = createClip({
      body: {
        ...createClip().body,
        frames: [
          { source: 'first.png', durationMs: 50 },
          { source: 'second.png', durationMs: 100 },
          { source: 'third.png', durationMs: 200 },
        ],
      },
    });
    player.play(clip, { type: 'until_replaced' });
    player.tick(410);
    expect(bodySource(player.getPresentationState())).toBe('second.png');
  });

  it('keeps repeated fractional ticks aligned with the same frame boundary as one whole tick', () => {
    const { renderer } = createRenderer();
    const player = new AnimationPlayer(renderer);
    player.play(createClip(), { type: 'until_replaced' });
    for (let index = 0; index < 1250; index += 1) player.tick(0.1);

    expect(bodySource(player.getPresentationState())).toBe('walk_1.png');
  });

  it('completes none once at the final body frame and ignores subsequent ticks', () => {
    const { renderer, states } = createRenderer();
    const player = new AnimationPlayer(renderer);
    const onCompleted = vi.fn();
    player.onCompleted(onCompleted);
    player.play(createClip(), { type: 'none' });
    player.tick(500);

    expect(bodySource(player.getPresentationState())).toBe('walk_3.png');
    expect(onCompleted).toHaveBeenCalledWith({ clipKey: 'body_walk', loopCount: 1, sessionElapsedMs: 500 });
    expect(states).toHaveLength(2);
    player.tick(125);
    expect(states).toHaveLength(2);
  });

  it('completes bounded playback after normalized cycle count and does not complete replaced clips', () => {
    const { renderer } = createRenderer();
    const player = new AnimationPlayer(renderer);
    const onCompleted = vi.fn();
    player.onCompleted(onCompleted);
    player.play(createClip(), { type: 'bounded', count: 2 });
    player.tick(999);
    expect(onCompleted).not.toHaveBeenCalled();
    player.tick(1);
    expect(onCompleted).toHaveBeenCalledWith({ clipKey: 'body_walk', loopCount: 2, sessionElapsedMs: 1000 });

    player.play(createClip({ key: 'replacement' }), { type: 'bounded', count: 1 });
    expect(onCompleted).toHaveBeenCalledTimes(1);
    player.tick(500);
    expect(onCompleted).toHaveBeenCalledWith({ clipKey: 'replacement', loopCount: 1, sessionElapsedMs: 500 });
  });

  it('supports loop, hold, and once overlay modes independently of body playback', () => {
    const { renderer } = createRenderer();
    const player = new AnimationPlayer(renderer);
    const clip = createClip({
      face: {
        id: 'face', category: 'face', animationKey: 'face_blink', zIndex: 20, playbackMode: 'hold',
        fps: 10, frames: [{ source: 'face_0.png' }, { source: 'face_1.png' }],
      },
      expression: {
        id: 'expression', category: 'expression', animationKey: 'expression_wink', zIndex: 21, playbackMode: 'once',
        fps: 10, frames: [{ source: 'expression_0.png' }, { source: 'expression_1.png' }],
      },
      props: [{
        id: 'prop_sparkle', category: 'props', animationKey: 'prop_sparkle', zIndex: 43, playbackMode: 'loop',
        fps: 10, frames: [{ source: 'prop_0.png' }, { source: 'prop_1.png' }],
      }],
    });
    player.play(clip, { type: 'until_replaced' });
    player.tick(250);

    const layers = player.getPresentationState()?.layers;
    expect(layers?.map((layer) => layer.id)).toEqual(['base_body', 'face', 'prop_sparkle']);
    expect(layerSource(layers, 1)).toBe('face_1.png');
    expect(layerSource(layers, 2)).toBe('prop_0.png');
  });

  it('aligns the face pivot to the active body-frame anchor and falls back to a zero offset', () => {
    const { renderer } = createRenderer();
    const player = new AnimationPlayer(renderer);
    const clip = createClip({
      rootPivot: { x: 100, y: 200 },
      body: {
        ...createClip().body,
        pivot: { x: 100, y: 200 },
        frames: [
          { source: 'body_0.png', pivot: { x: 100, y: 200 }, anchors: { face: { x: 100, y: 50 } } },
          { source: 'body_1.png', pivot: { x: 110, y: 210 }, anchors: { face: { x: 114, y: 56 } } },
          { source: 'body_2.png', pivot: { x: 100, y: 200 } },
        ],
        defaultAnchors: { face: { x: 100, y: 50 } },
        frameMeta: [{}, { anchors: { face: { x: 999, y: 999 } } }, {}],
      },
      face: {
        id: 'face', category: 'face', animationKey: 'face_happy', zIndex: 20, playbackMode: 'hold',
        pivot: { x: 100, y: 50 }, anchorName: 'face', fps: 8,
        frames: [
          { source: 'face_0.png', pivot: { x: 100, y: 50 } },
          { source: 'face_1.png', pivot: { x: 90, y: 40 } },
        ],
      },
    });

    player.play(clip, { type: 'until_replaced' });
    expect(player.getPresentationState()?.layers[1]?.offset).toEqual({ x: 0, y: -150 });
    expect(player.getPresentationState()?.layers[1]?.pivot).toEqual({ x: 100, y: 50 });
    player.tick(125);
    expect(player.getPresentationState()?.layers[1]?.offset).toEqual({ x: 4, y: -154 });
    expect(player.getPresentationState()?.layers[0]?.pivot).toEqual({ x: 110, y: 210 });
    expect(player.getPresentationState()?.layers[1]?.pivot).toEqual({ x: 90, y: 40 });
    player.tick(125);
    expect(player.getPresentationState()?.layers[1]?.offset).toEqual({ x: 0, y: -150 });

    const missingAnchorClip = createClip({
      face: {
        id: 'face', category: 'face', animationKey: 'face_happy', zIndex: 20, playbackMode: 'hold',
        pivot: { x: 100, y: 50 }, anchorName: 'face', frames: [{ source: 'face_0.png' }],
      },
    });
    player.play(missingAnchorClip, { type: 'until_replaced' });
    expect(player.getPresentationState()?.layers[1]?.offset).toEqual({ x: 0, y: 0 });
  });

  it('keeps a fixed face_gaze overlay at its baseline anchor during body bobbing', () => {
    const { renderer } = createRenderer();
    const player = new AnimationPlayer(renderer);
    const clip = createClip({
      body: {
        ...createClip().body,
        frames: [
          { source: 'body_0.png', anchors: { face: { x: 256, y: 126 } } },
          { source: 'body_1.png', anchors: { face: { x: 256, y: 122 } } },
        ],
      },
      face: {
        id: 'face', category: 'face', animationKey: 'face_gaze', zIndex: 20, playbackMode: 'hold',
        fixedFrameIndex: 3, followBodyAnchor: false, anchorName: 'face', pivot: { x: 256, y: 126 },
        offset: { x: 0, y: -334 }, frames: [{ source: 'gaze_0.png' }, { source: 'gaze_3.png' }],
      },
    });
    player.play(clip, { type: 'until_replaced' });
    expect(player.getPresentationState()?.layers[1]?.offset).toEqual({ x: 0, y: -334 });
    player.tick(125);
    expect(player.getPresentationState()?.layers[1]?.offset).toEqual({ x: 0, y: -334 });
  });

  it('preserves elapsed frame progress when updateClip is called with the same body clip', () => {
    const { renderer } = createRenderer();
    const player = new AnimationPlayer(renderer);
    const clip1 = createClip();
    player.play(clip1, { type: 'until_replaced' });
    player.tick(250);
    expect(bodySource(player.getPresentationState())).toBe('walk_2.png');

    const clip2 = createClip({
      transform: { flipX: true, scale: 1.2 },
    });
    player.updateClip(clip2);
    expect(bodySource(player.getPresentationState())).toBe('walk_2.png');
    expect(player.getPresentationState()?.transform.scale).toBe(1.2);
  });

  it('treats invalid delta values as no-ops and is safe after destroy', () => {
    const { renderer, states } = createRenderer();
    const player = new AnimationPlayer(renderer);
    player.play(createClip(), { type: 'until_replaced' });
    player.tick(0);
    player.tick(Number.NaN);
    player.tick(Number.POSITIVE_INFINITY);
    expect(states).toHaveLength(1);
    player.destroy();
    player.play(createClip(), { type: 'until_replaced' });
    player.tick(100);
    expect(states).toHaveLength(1);
    expect(player.getPresentationState()).toBeUndefined();
  });

  it('resynchronizes real FSM terminal visuals after player rejection and stalled playback', () => {
    const rejectedFsm = new AnimationStateMachine('idle');
    const rejectedPlayer = new AnimationPlayer(createRenderer().renderer);
    expect(rejectedFsm.transition('START_SLEEP', true, false)).toBe(true);
    expect(() => rejectedPlayer.play(createClip({
      body: { ...createClip().body, frames: [] },
    }), { type: 'none' })).toThrow();
    expect(rejectedFsm.synchronizeTerminalState('sleep_loop')).toBe(true);
    expect(rejectedFsm.getCurrentState()).toBe('sleep_loop');
    expect(rejectedFsm.synchronizeTerminalState('sleep_loop')).toBe(false);

    const stalledFsm = new AnimationStateMachine('falling');
    const stalledPlayer = new AnimationPlayer(createRenderer().renderer);
    expect(stalledFsm.transition('LAND', true, false)).toBe(true);
    stalledPlayer.play(createClip({ key: 'body_land' }), { type: 'none' });
    expect(stalledFsm.synchronizeTerminalState('settle')).toBe(true);
    expect(stalledFsm.getCurrentState()).toBe('settle');
  });
});
