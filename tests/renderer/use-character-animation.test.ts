import { describe, expect, it } from 'vitest';
import { getPresentationSignature } from '../../src/renderer/hooks/useCharacterAnimation';
import type { RenderPresentationState } from '../../src/renderer/render-engine';

function state(frameSource: string): RenderPresentationState {
  return {
    viewport: { width: 512, height: 512 }, rootPivot: { x: 256, y: 460 }, transform: { flipX: false, scale: 1 },
    layers: [{
      id: 'base_body', category: 'body', zIndex: 10, animationKey: 'body_walk', pivot: { x: 256, y: 460 },
      offset: { x: 0, y: 0 }, opacity: 1, blendMode: 'normal', visible: true, frame: { source: frameSource },
    }],
  };
}

describe('Renderer: useCharacterAnimation publication signature', () => {
  it('does not change for repeated player emissions of the same rendered frame', () => {
    expect(getPresentationSignature(state('body_walk_00.png'))).toBe(getPresentationSignature(state('body_walk_00.png')));
  });

  it('changes when the active sprite frame changes', () => {
    expect(getPresentationSignature(state('body_walk_00.png'))).not.toBe(getPresentationSignature(state('body_walk_01.png')));
  });

  it('changes when a visible layer pivot or blend mode changes', () => {
    const base = state('body_walk_00.png');
    const baseLayer = base.layers[0];
    if (baseLayer === undefined) throw new Error('Test state must contain a body layer.');
    const movedPivot: RenderPresentationState = {
      ...base,
      layers: [{ ...baseLayer, pivot: { x: 250, y: 460 } }],
    };
    const changedBlend: RenderPresentationState = {
      ...base,
      layers: [{ ...baseLayer, blendMode: 'screen' }],
    };

    expect(getPresentationSignature(base)).not.toBe(getPresentationSignature(movedPivot));
    expect(getPresentationSignature(base)).not.toBe(getPresentationSignature(changedBlend));
  });

  it('changes when any visible procedural blush attribute changes', () => {
    const base: RenderPresentationState = {
      ...state('body_walk_00.png'),
      proceduralBlush: {
        id: 'procedural_blush', intensity: 0.5, blendMode: 'normal', color: '#ff8fab',
        leftCheek: { x: 180, y: 340 }, rightCheek: { x: 330, y: 340 }, radius: 20, opacity: 0.5,
      },
    };
    const baseBlush = base.proceduralBlush;
    if (baseBlush === undefined) throw new Error('Test state must contain procedural blush.');
    const changedBlush: RenderPresentationState = {
      ...base,
      proceduralBlush: { ...baseBlush, color: '#f43f5e', radius: 24, leftCheek: { x: 180, y: 342 } },
    };

    expect(getPresentationSignature(base)).not.toBe(getPresentationSignature(changedBlush));
  });
});
