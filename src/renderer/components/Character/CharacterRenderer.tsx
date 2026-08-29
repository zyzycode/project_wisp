import React, { useEffect, useMemo, useState } from 'react';
import type { AnimationIntent } from '../../../domain/animation/animation-intent';
import { createSystemAnimationIntent } from '../../../domain/animation/animation-intent';
import type {
  CharacterExpression,
  CharacterTheme,
} from '../../../domain/models/character-visuals';
import {
  DEFAULT_THEMES,
  calculateRenderedDimensions,
} from '../../../domain/models/character-visuals';
import { AssetResolver, ManifestLoader } from '../../render-engine';
import { useCharacterAnimation } from '../../hooks/useCharacterAnimation';
import { SpriteRenderer } from './SpriteRenderer';

export const BASE_CHARACTER_SIZE = { width: 240, height: 240 };

const manifestLoader = new ManifestLoader();
const INITIAL_RESOLVER = new AssetResolver(
  manifestLoader.load({ schemaVersion: 1, animations: {} }),
  { enableFaceOverlays: true }
);

let cachedManifestResolver: AssetResolver | null = null;

export interface CharacterRendererProps {
  expression?: CharacterExpression;
  theme?: CharacterTheme;
  scale?: number;
  flipX?: boolean;
  isDragging?: boolean;
  tiltDeg?: number;
  animationIntent?: AnimationIntent;
  onClick?: () => void;
  onDoubleClick?: () => void;
  onMouseDown?: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}

export const CharacterRenderer: React.FC<CharacterRendererProps> = ({
  expression = 'idle',
  theme = DEFAULT_THEMES.cosmic ?? Object.values(DEFAULT_THEMES)[0]!,
  scale = 1.0,
  flipX = false,
  isDragging = false,
  tiltDeg = 0,
  animationIntent,
  onClick,
  onDoubleClick,
  onMouseDown,
  onContextMenu,
}) => {
  const defaultIntent = useMemo(() => createSystemAnimationIntent('idle_blink'), []);
  const intent = animationIntent ?? defaultIntent;
  const [resolver, setResolver] = useState<AssetResolver>(() => cachedManifestResolver ?? INITIAL_RESOLVER);
  const presentationState = useCharacterAnimation(resolver, intent);
  const renderedSize = calculateRenderedDimensions(BASE_CHARACTER_SIZE, scale);

  const activePresentationState = useMemo(() => {
    if (presentationState === undefined) return undefined;
    if (presentationState.transform.flipX === flipX) return presentationState;
    return {
      ...presentationState,
      transform: {
        ...presentationState.transform,
        flipX,
      },
    };
  }, [presentationState, flipX]);

  useEffect(() => {
    let disposed = false;
    if (typeof fetch === 'function') {
      void fetch('/assets/sprites/manifest.json')
        .then(async (response) => {
          if (!response.ok) throw new Error(`Unable to load sprites: ${response.status}`);
          return response.json() as Promise<unknown>;
        })
        .then((manifest) => {
          if (!disposed) {
            const loaded = new AssetResolver(manifestLoader.load(manifest), {
              enableFaceOverlays: true,
            });
            cachedManifestResolver = loaded;
            setResolver(loaded);

            // Preload sprite frames into browser image decode cache to avoid micro-flashing
            if (typeof Image !== 'undefined' && manifest && typeof manifest === 'object') {
              for (const anim of Object.values(manifest as Record<string, { frames?: string[] }>)) {
                if (Array.isArray(anim?.frames)) {
                  for (const frameSrc of anim.frames) {
                    const img = new Image();
                    img.src = frameSrc;
                  }
                }
              }
            }
          }
        })
        .catch(() => undefined);
    }
    return (): void => {
      disposed = true;
    };
  }, []);

  return (
    <div
      className={`wisp-character-root ${isDragging ? 'dragging' : ''}`}
      data-testid="wisp-character-root"
      data-expression={expression}
      style={{
        width: `${renderedSize.width}px`,
        height: `${renderedSize.height}px`,
        transform: `rotate(${tiltDeg}deg)`,
        willChange: 'transform',
        filter: `drop-shadow(0 0 16px ${theme.palette.glow})`,
      }}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onMouseDown={onMouseDown}
      onContextMenu={onContextMenu}
    >
      <SpriteRenderer state={activePresentationState} />
    </div>
  );
};
