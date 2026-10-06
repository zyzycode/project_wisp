import { describe, expect, it, vi } from 'vitest';
import { createSystemAnimationIntent } from '../../src/domain/animation/animation-intent';
import { AnimationPlayer, AssetResolver, TechnicalFallbackController, type ICharacterRenderer, type RenderPresentationState, type VisibleRenderLayerDef } from '../../src/renderer/render-engine';

function layer(
  id: VisibleRenderLayerDef['id'],
  category: VisibleRenderLayerDef['category'],
  source: string
): VisibleRenderLayerDef {
  return {
    id, category, zIndex: category === 'body' ? 10 : 20, animationKey: id,
    pivot: { x: 256, y: 460 }, offset: { x: 0, y: 0 }, opacity: 1, blendMode: 'normal', visible: true,
    frame: { source },
  };
}

describe('Renderer: TechnicalFallbackController', () => {
  it('keeps the previous committed body frame when a new body frame fails', () => {
    const controller = new TechnicalFallbackController();
    const previous = layer('base_body', 'body', 'body_walk_00.png');
    const failed = layer('base_body', 'body', 'body_walk_01.png');
    controller.recordLoaded(previous);
    controller.recordFailed(failed, failed.frame.source);

    expect(controller.resolve(failed)).toEqual(previous);
  });

  it('uses the embedded system baseline if the first body asset fails', () => {
    const controller = new TechnicalFallbackController();
    const failed = layer('base_body', 'body', '/missing-body.png');
    controller.recordFailed(failed, failed.frame.source);
    const resolved = controller.resolve(failed);

    expect(resolved?.visible && resolved.frame.source).toBe('system://wisp/default_idle.svg');
  });

  it('omits failed optional layers without changing the body layer', () => {
    const controller = new TechnicalFallbackController();
    const body = layer('base_body', 'body', 'body_walk_00.png');
    const face = layer('face', 'face', '/missing-face.png');
    controller.recordLoaded(body);
    controller.recordFailed(face, face.frame.source);

    expect(controller.resolve(body)).toEqual(body);
    expect(controller.resolve(face)).toBeUndefined();
  });

  it('ignores a late error from frame A after desired frame B has replaced it', () => {
    const controller = new TechnicalFallbackController();
    const frameA = layer('base_body', 'body', 'body_walk_00.png');
    const frameB = layer('base_body', 'body', 'body_walk_01.png');
    controller.recordLoaded(frameA);

    expect(controller.recordFailed(frameB, frameA.frame.source)).toBe(false);
    expect(controller.resolve(frameB)).toEqual(frameB);
  });

  it('continues bounded playback and completion after Level-3 semantic fallback', () => {
    const states: RenderPresentationState[] = [];
    const renderer: ICharacterRenderer = { render: (state): void => { states.push(state); }, destroy: (): void => undefined };
    const player = new AnimationPlayer(renderer);
    const completed = vi.fn();
    player.onCompleted(completed);
    const clip = new AssetResolver({ schemaVersion: 1, animations: {} }).resolve(createSystemAnimationIntent('sleep_start'));

    player.play(clip, { type: 'none' });
    player.tick(1000);

    const finalState = states[states.length - 1];
    const finalLayer = finalState?.layers[0];
    expect(finalLayer?.visible && finalLayer.frame.source).toBe('system://wisp/default_idle.svg');
    expect(completed).toHaveBeenCalledWith({ clipKey: 'system_default_idle', loopCount: 1, sessionElapsedMs: 1000 });
  });
});
