import React from 'react';
import type { ProceduralBlushDef } from '../../render-engine/types';

export interface ProceduralBlushProps {
  blush: ProceduralBlushDef;
}

export const ProceduralBlush: React.FC<ProceduralBlushProps> = ({ blush }) => (
  <g data-layer-id={blush.id} opacity={blush.opacity} style={{ mixBlendMode: blush.blendMode }}>
    <circle cx={blush.leftCheek.x} cy={blush.leftCheek.y} r={blush.radius} fill={blush.color} />
    <circle cx={blush.rightCheek.x} cy={blush.rightCheek.y} r={blush.radius} fill={blush.color} />
  </g>
);
