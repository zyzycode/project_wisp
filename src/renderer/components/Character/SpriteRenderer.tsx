import React, { useRef, useState } from 'react';
import { ProceduralBlush } from './ProceduralBlush';
import { PropsOverlay } from './PropsOverlay';
import type { RenderLayerDef, RenderPresentationState, VisibleRenderLayerDef } from '../../render-engine/types';
import { TechnicalFallbackController } from '../../render-engine/technical-fallback-controller';

export interface SpriteRendererProps {
  state?: RenderPresentationState;
}

/** Displays already-resolved layers only; it never chooses clips or assets. */
export const SpriteRenderer: React.FC<SpriteRendererProps> = ({ state }) => {
  const controllerRef = useRef(new TechnicalFallbackController());
  const [, setTechnicalRevision] = useState(0);
  if (state === undefined) return null;
  const controller = controllerRef.current;
  const visibleLayers = state.layers
    .map((layer) => controller.resolve(layer))
    .filter((layer): layer is VisibleRenderLayerDef => layer !== undefined && isVisibleLayer(layer))
    .sort((left, right) => left.zIndex - right.zIndex);
  const primaryLayers = visibleLayers.filter((layer) => layer.category !== 'props');
  const propLayers = visibleLayers.filter((layer) => layer.category === 'props');
  const { viewport, rootPivot, transform } = state;
  const transformValue = [
    `translate(${rootPivot.x} ${rootPivot.y})`,
    `scale(${transform.flipX ? -transform.scale : transform.scale} ${transform.scale})`,
    `translate(${-rootPivot.x} ${-rootPivot.y})`,
  ].join(' ');

  return (
    <svg
      className="wisp-sprite-canvas"
      data-testid="sprite-renderer"
      viewBox={`0 0 ${viewport.width} ${viewport.height}`}
      width="100%"
      height="100%"
      aria-label="Wisp sprite animation"
    >
      <g transform={transformValue}>
        {primaryLayers.map((layer) => (
          <SpriteLayer
            key={layer.id}
            layer={layer}
            state={state}
            onLoad={() => controller.recordLoaded(layer)}
            onError={(failedSource) => {
              if (controller.recordFailed(layer, failedSource)) setTechnicalRevision((revision) => revision + 1);
            }}
          />
        ))}
        {state.proceduralBlush === undefined ? null : <ProceduralBlush blush={state.proceduralBlush} />}
        <PropsOverlay
          layers={propLayers}
          viewport={viewport}
          rootPivot={rootPivot}
          onLayerLoad={(layer) => controller.recordLoaded(layer)}
          onLayerError={(layer, failedSource) => {
            if (controller.recordFailed(layer, failedSource)) setTechnicalRevision((revision) => revision + 1);
          }}
        />
      </g>
    </svg>
  );
};

function SpriteLayer({
  layer,
  state,
  onLoad,
  onError,
}: {
  readonly layer: VisibleRenderLayerDef;
  readonly state: RenderPresentationState;
  readonly onLoad: () => void;
  readonly onError: (failedSource: string) => void;
}): React.ReactElement {
  const x = state.rootPivot.x + layer.offset.x - layer.pivot.x;
  const y = state.rootPivot.y + layer.offset.y - layer.pivot.y;
  return (
    <image
      data-layer-id={layer.id}
      data-frame-source={layer.frame.source}
      href={resolveSpriteSource(layer.frame.source)}
      x={x}
      y={y}
      width={state.viewport.width}
      height={state.viewport.height}
      opacity={layer.opacity}
      style={{ mixBlendMode: layer.blendMode === 'additive' ? 'screen' : layer.blendMode }}
      preserveAspectRatio="xMidYMid meet"
      onLoad={onLoad}
      onError={(event) => onError(event.currentTarget.getAttribute('data-frame-source') ?? '')}
    />
  );
}

function isVisibleLayer(layer: RenderLayerDef): layer is VisibleRenderLayerDef {
  return layer.visible;
}

export function resolveSpriteSource(source: string): string {
  return source === 'system://wisp/default_idle.svg'
    ? SYSTEM_IDLE_FALLBACK_SOURCE
    : source;
}

const SYSTEM_IDLE_FALLBACK_SOURCE = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 512 512%22%3E%3Cpath fill=%22%237c3aed%22 d=%22M256 48c105 0 176 82 176 190 0 124-80 206-176 226C160 444 80 362 80 238 80 130 151 48 256 48Z%22/%3E%3Ccircle cx=%22195%22 cy=%22220%22 r=%2218%22 fill=%22%231e1b4b%22/%3E%3Ccircle cx=%22317%22 cy=%22220%22 r=%2218%22 fill=%22%231e1b4b%22/%3E%3Cpath d=%22M205 302c34 25 68 25 102 0%22 fill=%22none%22 stroke=%22%231e1b4b%22 stroke-linecap=%22round%22 stroke-width=%2214%22/%3E%3C/svg%3E';
