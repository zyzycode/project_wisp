import React from 'react';
import type { VisibleRenderLayerDef } from '../../render-engine/types';

export interface PropsOverlayProps {
  layers: readonly VisibleRenderLayerDef[];
  viewport: { readonly width: number; readonly height: number };
  rootPivot: { readonly x: number; readonly y: number };
}

export const PropsOverlay: React.FC<PropsOverlayProps> = ({ layers, viewport, rootPivot }) => (
  <>
    {layers.map((layer) => {
      const x = rootPivot.x + layer.offset.x - layer.pivot.x;
      const y = rootPivot.y + layer.offset.y - layer.pivot.y;
      return (
        <image
          key={layer.id}
          data-layer-id={layer.id}
          data-frame-source={layer.frame.source}
          href={layer.frame.source}
          x={x}
          y={y}
          width={viewport.width}
          height={viewport.height}
          opacity={layer.opacity}
          style={{ mixBlendMode: layer.blendMode === 'additive' ? 'screen' : layer.blendMode }}
          preserveAspectRatio="xMidYMid meet"
        />
      );
    })}
  </>
);
