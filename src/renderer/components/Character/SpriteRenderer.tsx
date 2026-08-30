import React, { useCallback, useRef, useState } from 'react';
import { ProceduralBlush } from './ProceduralBlush';
import { PropsOverlay } from './PropsOverlay';
import type { RenderLayerDef, RenderPresentationState, VisibleRenderLayerDef } from '../../render-engine/types';
import { TechnicalFallbackController } from '../../render-engine/technical-fallback-controller';
import type { GazeGeometry, PupilOffset } from '../../../domain/behavior/gaze-engine';
import { useGaze } from '../../hooks/useGaze';

const PUPIL_PIVOT = { x: 256, y: 126 };

export interface SpriteRendererProps {
  state?: RenderPresentationState;
  /** A procedural full-canvas pupil layer, placed directly above the face layer. */
  pupilOverlay?: {
    readonly source: string;
    /** Active body-frame face anchor in source pixels. */
    readonly anchor: { readonly x: number; readonly y: number };
  };
}

/** Displays already-resolved layers only; it never chooses clips or assets. */
export const SpriteRenderer: React.FC<SpriteRendererProps> = ({ state, pupilOverlay }) => {
  const controllerRef = useRef(new TechnicalFallbackController());
  const [, setTechnicalRevision] = useState(0);
  if (state === undefined) return null;
  const controller = controllerRef.current;
  const visibleLayers = state.layers
    .map((layer) => controller.resolve(layer))
    .filter((layer): layer is VisibleRenderLayerDef => layer !== undefined && isVisibleLayer(layer))
    .sort((left, right) => left.zIndex - right.zIndex);
  const primaryLayers = visibleLayers.filter((layer) => layer.category !== 'props');
  const layersBelowPupils = primaryLayers.filter((layer) => layer.zIndex <= 20);
  const layersAbovePupils = primaryLayers.filter((layer) => layer.zIndex > 20);
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
        {layersBelowPupils.map((layer) => (
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
        {pupilOverlay === undefined ? null : <PupilLayer state={state} overlay={pupilOverlay} />}
        {layersAbovePupils.map((layer) => (
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

function PupilLayer({
  state,
  overlay,
}: {
  readonly state: RenderPresentationState;
  readonly overlay: NonNullable<SpriteRendererProps['pupilOverlay']>;
}): React.ReactElement {
  const imageRef = useRef<SVGImageElement>(null);
  const applyOffset = useCallback((offset: PupilOffset): void => {
    const image = imageRef.current;
    if (image === null) return;
    image.setAttribute('transform', getPupilTransform(overlay.anchor, offset));
    image.setAttribute('data-pupil-offset-x', String(offset.xSourcePx));
    image.setAttribute('data-pupil-offset-y', String(offset.ySourcePx));
  }, [overlay.anchor]);
  const getGeometry = useCallback((): GazeGeometry | undefined => {
    const svg = imageRef.current?.ownerSVGElement;
    if (svg === null || svg === undefined) return undefined;
    const rect = svg.getBoundingClientRect();
    const sourceScale = Math.min(rect.width / state.viewport.width, rect.height / state.viewport.height);
    if (!Number.isFinite(sourceScale) || sourceScale <= 0) return undefined;
    const letterboxX = (rect.width - state.viewport.width * sourceScale) / 2;
    const letterboxY = (rect.height - state.viewport.height * sourceScale) / 2;
    return {
      rootGlobalPosition: getGazeRootGlobalPosition({
        canvasGlobalTopLeft: { x: window.screenX + rect.left + letterboxX, y: window.screenY + rect.top + letterboxY },
        rootPivot: state.rootPivot,
        canvasScale: sourceScale,
        transformScale: state.transform.scale,
        flipX: state.transform.flipX,
      }),
      gazeOriginSourcePx: overlay.anchor,
      scale: sourceScale * state.transform.scale,
      flipX: state.transform.flipX,
    };
  }, [overlay.anchor, state.rootPivot, state.transform.flipX, state.transform.scale, state.viewport.height, state.viewport.width]);
  useGaze({ enabled: true, getGeometry, onPupilOffset: applyOffset });

  return (
    <image
      ref={imageRef}
      data-layer-id="pupils_normal"
      data-frame-source={overlay.source}
      data-pupil-offset-x="0"
      data-pupil-offset-y="0"
      href={resolveSpriteSource(overlay.source)}
      x={0}
      y={0}
      width={state.viewport.width}
      height={state.viewport.height}
      transform={getPupilTransform(overlay.anchor, { xSourcePx: 0, ySourcePx: 0 })}
      preserveAspectRatio="xMidYMid meet"
      pointerEvents="none"
      style={{ mixBlendMode: 'normal' }}
    />
  );
}

export function getPupilTransform(
  anchor: { readonly x: number; readonly y: number },
  offset: PupilOffset
): string {
  return `translate(${anchor.x - PUPIL_PIVOT.x + offset.xSourcePx} ${anchor.y - PUPIL_PIVOT.y + offset.ySourcePx})`;
}

export function getGazeRootGlobalPosition({
  canvasGlobalTopLeft,
  rootPivot,
  canvasScale,
  transformScale,
  flipX,
}: {
  readonly canvasGlobalTopLeft: { readonly x: number; readonly y: number };
  readonly rootPivot: { readonly x: number; readonly y: number };
  /** CSS pixels per source pixel before the character's SVG group transform. */
  readonly canvasScale: number;
  /** The animation state's scale around rootPivot. */
  readonly transformScale: number;
  readonly flipX: boolean;
}): { x: number; y: number } {
  return {
    x: canvasGlobalTopLeft.x + rootPivot.x * canvasScale * (flipX ? 1 + transformScale : 1 - transformScale),
    y: canvasGlobalTopLeft.y + rootPivot.y * canvasScale * (1 - transformScale),
  };
}

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
