import React from 'react';
import type {
  CharacterExpression,
  CharacterTheme,
} from '../../../domain/models/character-visuals';
import {
  DEFAULT_THEMES,
  calculateRenderedDimensions,
} from '../../../domain/models/character-visuals';
import { WispAura } from './WispAura';
import { WispFace } from './WispFace';

export interface CharacterRendererProps {
  expression?: CharacterExpression;
  theme?: CharacterTheme;
  scale?: number;
  isDragging?: boolean;
  tiltDeg?: number;
  onClick?: () => void;
  onMouseDown?: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}

export const CharacterRenderer: React.FC<CharacterRendererProps> = ({
  expression = 'idle',
  theme = DEFAULT_THEMES.cosmic ?? Object.values(DEFAULT_THEMES)[0]!,
  scale = 1.0,
  isDragging = false,
  tiltDeg = 0,
  onClick,
  onMouseDown,
  onContextMenu,
}) => {
  const baseSize = { width: 100, height: 100 };
  const renderedSize = calculateRenderedDimensions(baseSize, scale);

  return (
    <div
      className={`wisp-character-root ${isDragging ? 'dragging' : ''}`}
      style={{
        width: `${renderedSize.width}px`,
        height: `${renderedSize.height}px`,
        transform: `rotate(${tiltDeg}deg)`,
      }}
      onClick={onClick}
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
        <WispFace expression={expression} eyeColor={theme.palette.eyes} />
      </svg>
    </div>
  );
};
