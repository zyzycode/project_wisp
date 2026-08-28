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
import { WispAura } from './WispAura';
import { AssetResolver, ManifestLoader, type NormalizedSpriteManifest } from '../../render-engine';
import { useCharacterAnimation } from '../../hooks/useCharacterAnimation';
import { SpriteRenderer } from './SpriteRenderer';

export interface CharacterRendererProps {
  expression?: CharacterExpression;
  theme?: CharacterTheme;
  scale?: number;
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
  const [resolver, setResolver] = useState<AssetResolver>(() => new AssetResolver(EMPTY_MANIFEST));
  const presentationState = useCharacterAnimation(resolver, intent);
  const baseSize = { width: 100, height: 100 };
  const renderedSize = calculateRenderedDimensions(baseSize, scale);

  useEffect(() => {
    let disposed = false;
    void fetch('/assets/sprites/manifest.json')
      .then(async (response) => {
        if (!response.ok) throw new Error(`Unable to load sprites: ${response.status}`);
        return response.json() as Promise<unknown>;
      })
      .then((manifest) => {
        if (!disposed) setResolver(new AssetResolver(new ManifestLoader().load(manifest)));
      })
      .catch(() => undefined);
    return (): void => { disposed = true; };
  }, []);

  return (
    <div
      className={`wisp-character-root ${isDragging ? 'dragging' : ''}`}
      data-expression={expression}
      style={{
        width: `${renderedSize.width}px`,
        height: `${renderedSize.height}px`,
        transform: `rotate(${tiltDeg}deg)`,
      }}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onMouseDown={onMouseDown}
      onContextMenu={onContextMenu}
    >
      <svg
        viewBox="0 0 100 100"
        width="100%"
        height="100%"
        className="wisp-svg-canvas"
        style={{
          filter: `drop-shadow(0 0 16px ${theme.palette.glow})`,
        }}
      >
        <WispAura palette={theme.palette} isDragging={isDragging} />
      </svg>
      <SpriteRenderer state={presentationState} />
    </div>
  );
};

const EMPTY_MANIFEST: NormalizedSpriteManifest = { schemaVersion: 1, animations: {} };
