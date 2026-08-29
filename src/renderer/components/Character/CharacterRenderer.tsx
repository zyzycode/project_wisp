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
import {
  AssetResolver,
  ManifestLoader,
  type RenderPresentationState,
  type SpritePoint,
} from '../../render-engine';
import { useCharacterAnimation } from '../../hooks/useCharacterAnimation';
import { SpriteRenderer } from './SpriteRenderer';

export const BASE_CHARACTER_SIZE = { width: 240, height: 240 };

const manifestLoader = new ManifestLoader();
const INITIAL_RESOLVER = new AssetResolver(
  manifestLoader.load({ schemaVersion: 1, animations: {} }),
  { enableFaceOverlays: true }
);

let cachedManifestResolver: AssetResolver | null = null;

export interface ManifestAnimationRegistry {
  bodyKeys: readonly string[];
  faceKeys: readonly string[];
}

export interface DebugAnimationSelection {
  bodyKey: string;
  faceKey?: string;
}

export interface CharacterRendererProps {
  expression?: CharacterExpression;
  theme?: CharacterTheme;
  scale?: number;
  flipX?: boolean;
  isDragging?: boolean;
  tiltDeg?: number;
  animationIntent?: AnimationIntent;
  debugAnimationSelection?: DebugAnimationSelection;
  showAnchorPoint?: boolean;
  onManifestAnimationsLoaded?: (registry: ManifestAnimationRegistry) => void;
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
  debugAnimationSelection,
  showAnchorPoint = false,
  onManifestAnimationsLoaded,
  onClick,
  onDoubleClick,
  onMouseDown,
  onContextMenu,
}) => {
  const defaultIntent = useMemo(() => createSystemAnimationIntent('idle_blink'), []);
  const intent = animationIntent ?? defaultIntent;
  const [resolver, setResolver] = useState<AssetResolver>(() => cachedManifestResolver ?? INITIAL_RESOLVER);
  const debugClip = useMemo(
    () => debugAnimationSelection === undefined
      ? undefined
      : resolver.resolveDebugSelection(debugAnimationSelection.bodyKey, debugAnimationSelection.faceKey),
    [debugAnimationSelection, resolver]
  );
  const presentationState = useCharacterAnimation(resolver, intent, debugClip);
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

  const faceAnchor = useMemo(() => {
    return getFaceAnchorPoint(activePresentationState);
  }, [activePresentationState]);

  useEffect(() => {
    onManifestAnimationsLoaded?.({
      bodyKeys: resolver.getAnimationKeys('body'),
      faceKeys: resolver.getAnimationKeys('face'),
    });
  }, [onManifestAnimationsLoaded, resolver]);

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
      {showAnchorPoint && faceAnchor && activePresentationState ? (
        <AnchorVisualizer
          anchor={faceAnchor}
          viewport={activePresentationState.viewport}
          rootPivot={activePresentationState.rootPivot}
          renderedSize={renderedSize}
          flipX={flipX}
        />
      ) : null}
    </div>
  );
};

export interface AnchorProjectionInput {
  anchor: SpritePoint;
  viewport: { width: number; height: number };
  rootPivot: SpritePoint;
  renderedSize: { width: number; height: number };
  flipX: boolean;
}

export function getFaceAnchorPoint(state: RenderPresentationState | undefined): SpritePoint | undefined {
  const bodyLayer = state?.layers.find((layer) => layer.id === 'base_body');
  return bodyLayer?.visible ? bodyLayer.frame.anchors?.face : undefined;
}

export function projectAnchorPoint({
  anchor,
  viewport,
  rootPivot,
  renderedSize,
  flipX,
}: AnchorProjectionInput): SpritePoint {
  const meetScale = Math.min(
    renderedSize.width / viewport.width,
    renderedSize.height / viewport.height
  );
  const letterboxX = (renderedSize.width - viewport.width * meetScale) / 2;
  const letterboxY = (renderedSize.height - viewport.height * meetScale) / 2;
  const sourceX = flipX
    ? rootPivot.x - (anchor.x - rootPivot.x)
    : anchor.x;
  return {
    x: letterboxX + sourceX * meetScale,
    y: letterboxY + anchor.y * meetScale,
  };
}

export const AnchorVisualizer: React.FC<AnchorProjectionInput> = (props) => {
  const projected = projectAnchorPoint(props);
  return (
    <div
      data-testid="face-anchor-marker"
      className="debug-anchor-point"
      data-anchor-x={props.anchor.x}
      data-anchor-y={props.anchor.y}
      data-projected-x={projected.x}
      data-projected-y={projected.y}
      aria-label="Face anchor point"
      style={{
        position: 'absolute',
        left: projected.x,
        top: projected.y,
        width: 16,
        height: 16,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transform: 'translate(-50%, -50%)',
        border: '2px solid #ffffff',
        borderRadius: '50%',
        background: '#ef4444',
        color: '#ffffff',
        font: 'bold 14px/1 monospace',
        boxShadow: '0 0 0 2px #000000',
        pointerEvents: 'none',
        zIndex: 200,
      }}
    >
      +
    </div>
  );
};
