import React, { useImperativeHandle, useRef, useState } from 'react';
import { ProceduralBlush } from './ProceduralBlush';
import { PropsOverlay } from './PropsOverlay';
import { resolveSpriteSource } from '../../render-engine/sprite-source';
import type { RenderLayerDef, RenderPresentationState, VisibleRenderLayerDef } from '../../render-engine/types';
import { TechnicalFallbackController } from '../../render-engine/technical-fallback-controller';
import { spriteTransform } from '../../render-engine/sprite-projection';
import { PupilPose, type PupilPoseHandle } from '../../render-engine/pupil-pose';

export interface SpriteRendererProps {
  state?: RenderPresentationState;
  onAssetLoadError?: (source: string) => void;
  gazeHandle?: React.Ref<PupilPoseHandle>;
}

/** Displays already-resolved layers only; it never chooses clips or assets. */
export const SpriteRenderer: React.FC<SpriteRendererProps> = ({ state, onAssetLoadError, gazeHandle }) => {
  const controllerRef = useRef(new TechnicalFallbackController());
  const pupilPose = useRef(new PupilPose()).current;
  useImperativeHandle(gazeHandle, () => pupilPose, [pupilPose]);
  const [, setTechnicalRevision] = useState(0);
  if (state === undefined) return null;
  const controller = controllerRef.current;
  const visibleLayers = controller.resolvePresentation(state)
    .filter((layer): layer is VisibleRenderLayerDef => layer !== undefined && isVisibleLayer(layer))
    .sort((left, right) => left.zIndex - right.zIndex);
  const primaryLayers = visibleLayers.filter((layer) => layer.category !== 'props');
  const propLayers = visibleLayers.filter((layer) => layer.category === 'props');
  const { viewport, rootPivot, transform } = state;
  const transformValue = spriteTransform(rootPivot, transform);

  return (
    <svg
      className="wisp-sprite-canvas"
      data-testid="sprite-renderer"
      viewBox={`0 0 ${viewport.width} ${viewport.height}`}
      preserveAspectRatio="xMidYMid meet"
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
            imageRef={layer.id === 'pupils' ? pupilPose.attach : undefined}
            onLoad={() => controller.recordLoaded(layer)}
            onError={(failedSource) => {
              onAssetLoadError?.(failedSource);
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
            onAssetLoadError?.(failedSource);
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
  imageRef,
}: {
  readonly layer: VisibleRenderLayerDef;
  readonly state: RenderPresentationState;
  readonly onLoad: () => void;
  readonly onError: (failedSource: string) => void;
  readonly imageRef?: React.Ref<SVGImageElement>;
}): React.ReactElement {
  const x = state.rootPivot.x + layer.offset.x - layer.pivot.x;
  const y = state.rootPivot.y + layer.offset.y - layer.pivot.y;
  return (
    <image
      ref={imageRef}
      data-layer-id={layer.id}
      data-frame-source={layer.frame.source}
      href={resolveSpriteSource(layer.frame.source)}
      x={x}
      y={y}
      width={layer.canvasSize?.width ?? state.viewport.width}
      height={layer.canvasSize?.height ?? state.viewport.height}
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
