import React, { useId } from 'react';
import type { CharacterColorPalette } from '../../../domain/models/character-visuals';

interface WispAuraProps {
  palette: CharacterColorPalette;
  isDragging?: boolean;
}

export const WispAura: React.FC<WispAuraProps> = ({ palette, isDragging = false }) => {
  const bodyGradientId = useId();
  const glowFilterId = useId();

  return (
    <g className={`wisp-aura-group ${isDragging ? 'aura-active' : ''}`}>
      <defs>
        {/* Radial body gradient */}
        <radialGradient id={bodyGradientId} cx="40%" cy="35%" r="60%">
          <stop offset="0%" stopColor={palette.accent} stopOpacity="1" />
          <stop offset="45%" stopColor={palette.primary} stopOpacity="0.95" />
          <stop offset="85%" stopColor={palette.secondary} stopOpacity="0.9" />
          <stop offset="100%" stopColor={palette.secondary} stopOpacity="0.6" />
        </radialGradient>

        {/* Outer Glow filter */}
        <filter id={glowFilterId} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur in="SourceGraphic" stdDeviation={isDragging ? 6 : 4} result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Floating orbital particles */}
      <circle className="wisp-orb orb-1" cx="22" cy="26" r="3.5" fill={palette.accent} opacity="0.8" />
      <circle className="wisp-orb orb-2" cx="78" cy="28" r="4.5" fill={palette.primary} opacity="0.75" />
      <circle className="wisp-orb orb-3" cx="72" cy="74" r="3" fill={palette.accent} opacity="0.7" />
      <circle className="wisp-orb orb-4" cx="25" cy="72" r="4" fill={palette.secondary} opacity="0.8" />

      {/* Main Ethereal Body */}
      <path
        className="wisp-body-path"
        d="M 50 15 
           C 72 15, 88 32, 88 52 
           C 88 74, 70 88, 50 88 
           C 30 88, 12 74, 12 52 
           C 12 32, 28 15, 50 15 Z"
        fill={`url(#${bodyGradientId})`}
        filter={`url(#${glowFilterId})`}
      />

      {/* Inner highlight */}
      <ellipse
        cx="40"
        cy="32"
        rx="18"
        ry="10"
        fill="#ffffff"
        opacity="0.25"
        transform="rotate(-15 40 32)"
      />
    </g>
  );
};
