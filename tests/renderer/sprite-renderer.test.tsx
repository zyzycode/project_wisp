import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { resolveSpriteSource, SpriteRenderer } from '../../src/renderer/components/Character/SpriteRenderer';
import { BASE_CHARACTER_SIZE, CharacterRenderer } from '../../src/renderer/components/Character/CharacterRenderer';
import type { RenderPresentationState } from '../../src/renderer/render-engine';
import { DEFAULT_THEMES } from '../../src/domain/models/character-visuals';

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

  it('applies transform and pivot correctly in SpriteRenderer SVG group', () => {
    const flippedState: RenderPresentationState = {
      ...state,
      transform: { flipX: true, scale: 1.25 },
    };
    const markup = renderToStaticMarkup(<SpriteRenderer state={flippedState} />);
    expect(markup).toContain('transform="translate(256 460) scale(-1.25 1.25) translate(-256 -460)"');
  });
});

describe('Renderer: CharacterRenderer Visual Polish', () => {
  it('renders purely via SpriteRenderer with no legacy SVG vector ball or aura paths', () => {
    const markup = renderToStaticMarkup(
      <CharacterRenderer theme={DEFAULT_THEMES.cosmic} scale={1.0} />
    );

    // Contains character root
    expect(markup).toContain('wisp-character-root');
    expect(markup).toContain('data-testid="wisp-character-root"');

    // Does NOT contain legacy SVG aura classes or elements
    expect(markup).not.toContain('wisp-aura-group');
    expect(markup).not.toContain('wisp-body-path');
    expect(markup).not.toContain('wisp-orb');
    expect(markup).not.toContain('wisp-face');
    expect(markup).not.toContain('wisp-svg-canvas');
  });

  it('applies configured base dimensions and scale to root container', () => {
    const markup100 = renderToStaticMarkup(<CharacterRenderer scale={1.0} />);
    expect(markup100).toContain(`width:${BASE_CHARACTER_SIZE.width}px`);
    expect(markup100).toContain(`height:${BASE_CHARACTER_SIZE.height}px`);

    const markup150 = renderToStaticMarkup(<CharacterRenderer scale={1.5} />);
    expect(markup150).toContain(`width:${Math.round(BASE_CHARACTER_SIZE.width * 1.5)}px`);
    expect(markup150).toContain(`height:${Math.round(BASE_CHARACTER_SIZE.height * 1.5)}px`);
  });

  it('applies theme drop-shadow glow and tiltDeg rotation cleanly', () => {
    const markup = renderToStaticMarkup(
      <CharacterRenderer theme={DEFAULT_THEMES.emerald} tiltDeg={12} isDragging />
    );
    expect(markup).toContain('rotate(12deg)');
    expect(markup).toContain('drop-shadow(0 0 16px rgba(16, 185, 129, 0.65))');
    expect(markup).toContain('dragging');
  });
});
