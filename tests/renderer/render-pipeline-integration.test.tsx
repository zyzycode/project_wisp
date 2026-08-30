import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AppLogger, LogBuffer } from '../../src/infrastructure/logging';
import { mapBehaviorIntentToAnimationIntent, createSystemAnimationIntent } from '../../src/domain/animation';
import { AssetResolver, AnimationPlayer, type ICharacterRenderer, type NormalizedSpriteManifest, type RenderPresentationState } from '../../src/renderer/render-engine';
import { DebugHUD } from '../../src/renderer/components/Debug';
import { SpriteRenderer } from '../../src/renderer/components/Character/SpriteRenderer';

const manifest: NormalizedSpriteManifest = {
  schemaVersion: 1,
  animations: {
    body_walk: animation('body_walk', 'body/walk', 'body'),
    body_walk_playful: animation('body_walk_playful', 'body/walk', 'body'),
    body_idle: animation('body_idle', 'body/idle', 'body'),
    body_sleep: animation('body_sleep', 'body/sleep', 'body'),
    face_sleep: animation('face_sleep', 'face/sleep', 'face'),
    face_winking: animation('face_winking', 'face/winking', 'face'),
    face_happy: animation('face_happy', 'face/happy', 'face'),
    expression_wink: animation('expression_wink', 'expression/wink', 'expression'),
    prop_pillow: animation('prop_pillow', 'props/pillow', 'props'),
    prop_sparkle: animation('prop_sparkle', 'props/sparkle', 'props'),
  },
};

function animation(
  key: string,
  category: `body/${string}` | `face/${string}` | `expression/${string}` | `props/${string}`,
  layer: 'body' | 'face' | 'expression' | 'props'
) {
  const pivot = layer === 'face' || layer === 'expression' ? { x: 256, y: 180 } : { x: 256, y: 460 };
  return {
    key,
    category,
    layer,
    frames: [0, 1, 2, 3].map((index) => ({
      source: `${key}_${index}.png`, durationMs: 125, pivot,
    })),
    framesCount: 4,
    fps: 8,
    pivot,
    ...(layer === 'body' ? {
      faceOverlay: {
        mode: 'overlay' as const,
        allowedFaceKeys: ['face_sleep', 'face_winking', 'face_happy'],
        fallback: 'face_sleep',
        anchor: 'face',
      },
      defaultAnchors: { face: { x: 256, y: 180 } },
      frameMeta: [
        { anchors: { face: { x: 256, y: 180 } } },
        { anchors: { face: { x: 256, y: 176 } } },
        { anchors: { face: { x: 256, y: 174 } } },
        { anchors: { face: { x: 256, y: 181 } } },
      ],
    } : {}),
    tags: [],
  } as const;
}

function createRecordingRenderer(): { renderer: ICharacterRenderer; states: RenderPresentationState[] } {
  const states: RenderPresentationState[] = [];
  return {
    renderer: { render: (state): void => { states.push(state); }, destroy: (): void => undefined },
    states,
  };
}

function currentBodySource(states: readonly RenderPresentationState[]): string | undefined {
  const state = states[states.length - 1];
  const layer = state?.layers[0];
  return layer?.visible ? layer.frame.source : undefined;
}

describe('Phase 13: render and telemetry pipeline', () => {
  it('maps wander through walk playback and renders all four sprite frames in sequence', () => {
    const behaviorIntent = { kind: 'wander', source: 'timer', priority: 'normal' } as const;
    const animationIntent = mapBehaviorIntentToAnimationIntent(behaviorIntent, 'neutral');
    const { renderer, states } = createRecordingRenderer();
    const player = new AnimationPlayer(renderer);
    const clip = new AssetResolver(manifest).resolve(animationIntent);

    expect(animationIntent.kind).toBe('walk');
    expect(clip.body.frames.map((frame) => frame.source)).toEqual([
      'body_walk_0.png', 'body_walk_1.png', 'body_walk_2.png', 'body_walk_3.png',
    ]);
    player.play(clip, { type: 'until_replaced' });
    expect(currentBodySource(states)).toBe('body_walk_0.png');
    player.tick(125);
    expect(currentBodySource(states)).toBe('body_walk_1.png');
    player.tick(125);
    expect(currentBodySource(states)).toBe('body_walk_2.png');
    player.tick(125);
    expect(currentBodySource(states)).toBe('body_walk_3.png');
    player.tick(125);
    const finalState = states[states.length - 1];
    expect(currentBodySource(states)).toBe('body_walk_0.png');
    expect(renderToStaticMarkup(<SpriteRenderer state={finalState} />)).toContain('body_walk_0.png');
  });

  it('resolves sleep with a pillow above the body and renders it at normative z-index', () => {
    const intent = createSystemAnimationIntent('sleep_loop', 'sleepy', { propHint: 'pillow' });
    const { renderer, states } = createRecordingRenderer();
    const player = new AnimationPlayer(renderer);
    player.play(new AssetResolver(manifest).resolve(intent), { type: 'until_replaced' });
    const state = states[0];
    const markup = renderToStaticMarkup(<SpriteRenderer state={state} />);

    expect(state?.layers.map((layer) => layer.zIndex)).toEqual([10, 20, 40]);
    expect(markup.indexOf('body_sleep_0.png')).toBeLessThan(markup.indexOf('prop_pillow_0.png'));
    expect(markup.indexOf('body_sleep_0.png')).toBeLessThan(markup.indexOf('face_sleep_0.png'));
    expect(markup.indexOf('face_sleep_0.png')).toBeLessThan(markup.indexOf('prop_pillow_0.png'));
  });

  it('renders face overlay aligned to body anchor in idle and bobs with body frames', () => {
    const intent = createSystemAnimationIntent('idle_blink', 'neutral', { expressionHint: 'happy' });
    const { renderer, states } = createRecordingRenderer();
    const player = new AnimationPlayer(renderer);
    player.play(new AssetResolver(manifest).resolve(intent), { type: 'until_replaced' });

    // Frame 0: anchor y=180 -> face offset y = 180 - 460 = -280 -> render y = 460 + (-280) - 180 = 0
    let markup = renderToStaticMarkup(<SpriteRenderer state={states[0]!} />);
    expect(markup).toMatch(/data-layer-id="face"[^>]*x="0" y="0"/);

    // Frame 1: anchor y=176 -> face offset y = 176 - 460 = -284 -> render y = 460 + (-284) - 180 = -4
    player.tick(125);
    markup = renderToStaticMarkup(<SpriteRenderer state={states[states.length - 1]!} />);
    expect(markup).toMatch(/data-layer-id="face"[^>]*x="0" y="-4"/);
  });

  it('composes shy blush above the body without creating a semantic expression layer', () => {
    const intent = createSystemAnimationIntent('idle_blink', 'shy', { expressionHint: 'blush' });
    const { renderer, states } = createRecordingRenderer();
    const player = new AnimationPlayer(renderer);
    player.play(new AssetResolver(manifest).resolve(intent), { type: 'until_replaced' });
    const state = states[0];
    const markup = renderToStaticMarkup(<SpriteRenderer state={state} />);

    expect(state?.proceduralBlush?.id).toBe('procedural_blush');
    expect(markup.indexOf('body_idle_0.png')).toBeLessThan(markup.indexOf('procedural_blush'));
  });

  it('falls back from an unavailable preferred animation to body_idle and still completes', () => {
    const idle = manifest.animations.body_idle;
    if (idle === undefined) throw new Error('Integration manifest must contain body_idle.');
    const fallbackManifest: NormalizedSpriteManifest = { schemaVersion: 1, animations: { body_idle: idle } };
    const { renderer, states } = createRecordingRenderer();
    const player = new AnimationPlayer(renderer);
    const completed = vi.fn();
    player.onCompleted(completed);
    const clip = new AssetResolver(fallbackManifest).resolve(createSystemAnimationIntent('thinking_loop'));

    expect(clip.body.animationKey).toBe('body_idle');
    player.play(clip, { type: 'none' });
    player.tick(500);
    expect(completed).toHaveBeenCalledWith({ clipKey: 'body_idle', loopCount: 1, sessionElapsedMs: 500 });
    expect(currentBodySource(states)).toBe('body_idle_3.png');
  });

  it('uses exact specialized assets at Level 1 and system baseline at Level 3', () => {
    const levelOneClip = new AssetResolver(manifest).resolve(createSystemAnimationIntent('walk', 'playful'));
    const levelThreeClip = new AssetResolver({ schemaVersion: 1, animations: {} }).resolve(createSystemAnimationIntent('dragged'));

    expect(levelOneClip.body.animationKey).toBe('body_walk_playful');
    expect(levelOneClip.face?.animationKey).toBe('face_winking');
    expect(levelOneClip.props?.[0]?.animationKey).toBe('prop_sparkle');
    expect(levelThreeClip.body.frames[0]?.source).toBe('system://wisp/default_idle.svg');
  });

  it('plays exact manifest body and face selections without consulting FSM intent mapping', () => {
    const selectedBody = manifest.animations.body_sleep;
    if (selectedBody === undefined) throw new Error('Integration manifest must contain body_sleep.');
    const customRootPivot = { x: 120, y: 180 };
    const debugManifest: NormalizedSpriteManifest = {
      ...manifest,
      animations: {
        ...manifest.animations,
        body_sleep: {
          ...selectedBody,
          canvasSize: { width: 400, height: 240 },
          pivot: customRootPivot,
          frames: selectedBody.frames.map((frame) => ({ ...frame, pivot: customRootPivot })),
        },
      },
    };
    const { renderer, states } = createRecordingRenderer();
    const player = new AnimationPlayer(renderer);
    const clip = new AssetResolver(debugManifest).resolveDebugSelection('body_sleep', 'face_sleep');

    player.play(clip, { type: 'until_replaced' });

    expect(states[0]?.layers.map((layer) => layer.animationKey)).toEqual([
      'body_sleep',
      'face_sleep',
    ]);
    expect(states[0]?.layers[1]).toMatchObject({
      id: 'face',
      pivot: customRootPivot,
      offset: { x: 0, y: 0 },
    });
    const markup = renderToStaticMarkup(<SpriteRenderer state={states[0]} />);
    expect(markup).toContain('face_sleep_0.png');
    expect(markup).toMatch(/data-layer-id="face"[^>]*x="0" y="0" width="400" height="240"/);
  });

  it('renders Main-compatible structured log entries and current needs in DebugHUD', () => {
    const buffer = new LogBuffer(5);
    const logger = new AppLogger({ level: 'debug', buffer, idFactory: () => 'integration-log', now: () => new Date('2026-08-28T00:00:00.000Z') });
    logger.warn('RenderEngine', 'using fallback body');
    const markup = renderToStaticMarkup(
      <DebugHUD
        needs={{ energy: 74, attention: 56, play: 60, comfort: 18 }}
        relationship={{ friendship: 320, love: 0, loveUnlocked: false }}
        tone="shy"
        animationState="idle"
        animationIntent={createSystemAnimationIntent('idle_blink', 'shy')}
        fps={60}
        logs={buffer.entries()}
        onClearLogs={vi.fn()}
      />
    );

    expect(markup).toContain('aria-valuenow="74"');
    expect(markup).toContain('using fallback body');
    expect(markup).toContain('debug-log-warn');
  });
});
