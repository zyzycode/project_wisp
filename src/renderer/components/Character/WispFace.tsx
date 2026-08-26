import React from 'react';
import type { CharacterExpression } from '../../../domain/models/character-visuals';

interface WispFaceProps {
  expression: CharacterExpression;
  eyeColor?: string;
}

export const WispFace: React.FC<WispFaceProps> = ({
  expression,
  eyeColor = '#ffffff',
}) => {
  switch (expression) {
    case 'happy':
      return (
        <g className="wisp-face face-happy">
          {/* Happy Curved Eyes */}
          <path
            d="M 32 45 Q 38 38 44 45"
            fill="none"
            stroke={eyeColor}
            strokeWidth="3.5"
            strokeLinecap="round"
          />
          <path
            d="M 56 45 Q 62 38 68 45"
            fill="none"
            stroke={eyeColor}
            strokeWidth="3.5"
            strokeLinecap="round"
          />
          {/* Cute Smile */}
          <path
            d="M 44 54 Q 50 60 56 54"
            fill="none"
            stroke={eyeColor}
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </g>
      );

    case 'curious':
      return (
        <g className="wisp-face face-curious">
          {/* One larger inquisitive eye */}
          <circle cx="37" cy="44" r="5" fill={eyeColor} />
          <circle cx="63" cy="43" r="6.5" fill={eyeColor} />
          {/* Small tilted mouth */}
          <ellipse cx="50" cy="55" rx="3" ry="2" fill={eyeColor} />
        </g>
      );

    case 'sleepy':
      return (
        <g className="wisp-face face-sleepy">
          {/* Closed flat/sleeping eyes */}
          <line
            x1="32"
            y1="46"
            x2="44"
            y2="46"
            stroke={eyeColor}
            strokeWidth="3"
            strokeLinecap="round"
          />
          <line
            x1="56"
            y1="46"
            x2="68"
            y2="46"
            stroke={eyeColor}
            strokeWidth="3"
            strokeLinecap="round"
          />
          {/* Small gentle mouth */}
          <path
            d="M 47 55 Q 50 57 53 55"
            fill="none"
            stroke={eyeColor}
            strokeWidth="2"
            strokeLinecap="round"
          />
        </g>
      );

    case 'surprised':
      return (
        <g className="wisp-face face-surprised">
          {/* Wide round eyes */}
          <circle cx="36" cy="43" r="6" fill={eyeColor} />
          <circle cx="64" cy="43" r="6" fill={eyeColor} />
          {/* Open 'O' mouth */}
          <circle cx="50" cy="55" r="4.5" fill={eyeColor} />
        </g>
      );

    case 'flying':
      return (
        <g className="wisp-face face-flying">
          {/* Sparkly focused eyes */}
          <ellipse cx="38" cy="44" rx="4.5" ry="6" fill={eyeColor} />
          <ellipse cx="62" cy="44" rx="4.5" ry="6" fill={eyeColor} />
          <circle cx="36" cy="42" r="1.5" fill="#38bdf8" />
          <circle cx="60" cy="42" r="1.5" fill="#38bdf8" />
          {/* Joyful open mouth */}
          <path
            d="M 43 53 Q 50 61 57 53 Z"
            fill={eyeColor}
          />
        </g>
      );

    case 'idle':
    default:
      return (
        <g className="wisp-face face-idle">
          {/* Normal blinking eyes */}
          <ellipse
            className="wisp-blinking-eye"
            cx="38"
            cy="44"
            rx="4"
            ry="6"
            fill={eyeColor}
          />
          <ellipse
            className="wisp-blinking-eye"
            cx="62"
            cy="44"
            rx="4"
            ry="6"
            fill={eyeColor}
          />
          {/* Neutral soft mouth */}
          <path
            d="M 46 54 Q 50 57 54 54"
            fill="none"
            stroke={eyeColor}
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </g>
      );
  }
};
