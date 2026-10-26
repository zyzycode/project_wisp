import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { resolveSpriteSource, SpriteRenderer } from '../../src/renderer/components/Character/SpriteRenderer';
import {
  AnchorVisualizer,
  BASE_CHARACTER_SIZE,
  CharacterRenderer,
  getFaceAnchorPoint,
  projectAnchorPoint,
} from '../../src/renderer/components/Character/CharacterRenderer';
import type { RenderPresentationState } from '../../src/renderer/render-engine';

const state: RenderPresentationState = {
  viewport: { width: 512, height: 512 },
  rootPivot: { x: 256, y: 460 },
  transform: { flipX: false, scale: 1 },
  layers: [
    layer('base_body', 'body', 10, 'body_walk_02.png'),
    layer('face', 'face', 20, 'face_happy_02.png'),
    layer('expression', 'expression', 21, 'expression_wink.png'),
    layer('prop_heart', 'props', 41, 'prop_heart.png', 'additive'),
  ],
  proceduralBlush: {
    id: 'procedural_blush', intensity: 0.65, blendMode: 'normal', color: '#ff8fab',
    leftCheek: { x: 186, y: 345 }, rightCheek: { x: 326, y: 345 }, radius: 26, opacity: 0.5,
  },
};

function layer(
  id: 'base_body' | 'face' | 'expression' | 'prop_heart',
  category: 'body' | 'face' | 'expression' | 'props',
  zIndex: number,
  source: string,
  blendMode: 'normal' | 'additive' = 'normal'
) {
  return {
    id, category, zIndex, animationKey: id, pivot: { x: 256, y: 460 }, offset: { x: 0, y: 0 },
    opacity: 1, blendMode, visible: true as const, frame: { source },
  };
}

describe('Renderer: SpriteRenderer', () => {
  it('renders body, face, expression, blush, and props in normative DOM order', () => {
    const markup = renderToStaticMarkup(<SpriteRenderer state={state} />);

    expect(markup).toContain('data-frame-source="body_walk_02.png"');
    expect(markup).toContain('data-layer-id="procedural_blush"');
    expect(markup).toContain('data-frame-source="prop_heart.png"');
    expect(markup.indexOf('body_walk_02.png')).toBeLessThan(markup.indexOf('face_happy_02.png'));
    expect(markup.indexOf('face_happy_02.png')).toBeLessThan(markup.indexOf('expression_wink.png'));
    expect(markup.indexOf('expression_wink.png')).toBeLessThan(markup.indexOf('procedural_blush'));
    expect(markup.indexOf('procedural_blush')).toBeLessThan(markup.indexOf('prop_heart.png'));
  });

  it('uses the current frame source directly without animation-key asset lookup', () => {
    const markup = renderToStaticMarkup(<SpriteRenderer state={state} />);
    expect(markup).toContain('href="body_walk_02.png"');
  });

  it('maps the system fallback URI to the bundled baseline asset', () => {
    const fallbackState: RenderPresentationState = {
      ...state,
      layers: [layer('base_body', 'body', 10, 'system://wisp/default_idle.svg')],
    };

    expect(resolveSpriteSource('system://wisp/default_idle.svg')).toMatch(/^data:image\/svg\+xml,/);
    expect(renderToStaticMarkup(<SpriteRenderer state={fallbackState} />)).toContain('data:image/svg+xml,');
  });

  it('normalizes absolute /assets/ URLs to relative ./assets/ paths for packaged file:// environments', () => {
    expect(resolveSpriteSource('/assets/sprites/body/idle/body_idle_00.png')).toBe(
      './assets/sprites/body/idle/body_idle_00.png'
    );
  });

  it('applies transform and pivot correctly in SpriteRenderer SVG group', () => {
    const flippedState: RenderPresentationState = {
      ...state,
      transform: { flipX: true, scale: 1.25 },
    };
    const markup = renderToStaticMarkup(<SpriteRenderer state={flippedState} />);
    expect(markup).toContain('transform="translate(256 460) scale(-1.25 1.25) translate(-256 -460)"');
  });

  it('applies Skin-owned squash, stretch, and rotation around the sprite root pivot', () => {
    const reflexState: RenderPresentationState = {
      ...state,
      transform: {
        flipX: true,
        scale: 1,
        scaleX: 1.08,
        scaleY: 0.92,
        rotationDeg: 12,
      },
    };

    expect(renderToStaticMarkup(<SpriteRenderer state={reflexState} />)).toContain(
      'transform="translate(256 460) rotate(12) scale(-1.08 0.92) translate(-256 -460)"'
    );
  });
});

describe('Renderer: CharacterRenderer Visual Polish', () => {
  it('uses the fixed character dimensions from the shared layout', () => {
    const markup = renderToStaticMarkup(<CharacterRenderer />);
    expect(markup).toContain(`width:${BASE_CHARACTER_SIZE.width}px`);
    expect(markup).toContain(`height:${BASE_CHARACTER_SIZE.height}px`);
  });

  it('applies the standard drop-shadow glow and dragging class', () => {
    const markup = renderToStaticMarkup(
      <CharacterRenderer isDragging />
    );
    expect(markup).toContain('drop-shadow(0 0 16px rgba(168, 85, 247, 0.65))');
    expect(markup).toContain('dragging');
  });

  it('projects the face anchor with scale and mirrors it around the root pivot', () => {
    const common = {
      anchor: { x: 160, y: 120 },
      viewport: { width: 512, height: 512 },
      rootPivot: { x: 256, y: 460 },
      renderedSize: { width: 480, height: 480 },
    };

    expect(projectAnchorPoint({ ...common, flipX: false })).toEqual({ x: 150, y: 112.5 });
    expect(projectAnchorPoint({ ...common, flipX: true })).toEqual({ x: 330, y: 112.5 });
  });

  it('matches xMidYMid meet projection for non-square viewports and containers', () => {
    const common = {
      anchor: { x: 100, y: 50 },
      viewport: { width: 400, height: 200 },
      rootPivot: { x: 200, y: 180 },
      renderedSize: { width: 300, height: 300 },
    };

    expect(projectAnchorPoint({ ...common, flipX: false })).toEqual({ x: 75, y: 112.5 });
    expect(projectAnchorPoint({ ...common, flipX: true })).toEqual({ x: 225, y: 112.5 });
  });

  it('projects rotation and unequal scale about the same pivot as the sprite', () => {
    const projected = projectAnchorPoint({ anchor: { x: 120, y: 50 },
      viewport: { width: 400, height: 200 }, rootPivot: { x: 100, y: 100 },
      renderedSize: { width: 300, height: 300 }, flipX: true,
      scale: 1, scaleX: 2, scaleY: 0.5, rotationDeg: 90 });
    expect(projected.x).toBeCloseTo(93.75);
    expect(projected.y).toBeCloseTo(120);
  });

  it('reads the face anchor from the currently rendered body frame', () => {
    const bodyLayer = state.layers[0];
    if (bodyLayer === undefined || !bodyLayer.visible) throw new Error('Body layer fixture is required.');
    const anchoredState: RenderPresentationState = {
      ...state,
      layers: [{
        ...bodyLayer,
        frame: { ...bodyLayer.frame, anchors: { face: { x: 254, y: 122 } } },
      }],
    };

    expect(getFaceAnchorPoint(anchoredState)).toEqual({ x: 254, y: 122 });
    expect(getFaceAnchorPoint({ ...anchoredState, layers: [] })).toBeUndefined();
  });

  it('renders a contrasting marker at the projected face anchor position', () => {
    const markup = renderToStaticMarkup(
      <AnchorVisualizer
        anchor={{ x: 256, y: 126 }}
        viewport={{ width: 512, height: 512 }}
        rootPivot={{ x: 256, y: 460 }}
        renderedSize={{ width: 240, height: 240 }}
        flipX
      />
    );

    expect(markup).toContain('data-testid="face-anchor-marker"');
    expect(markup).toContain('class="debug-anchor-point"');
    expect(markup).toContain('data-anchor-x="256"');
    expect(markup).toContain('data-projected-x="120"');
    expect(markup).toContain('data-projected-y="59.0625"');
    expect(markup).toContain('background:#ef4444');
    expect(markup).toContain('>+</div>');
  });
});
