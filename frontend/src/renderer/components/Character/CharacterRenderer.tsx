import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PET_PRESENTATION_LAYOUT } from '../../../shared/pet-presentation-layout';
import { createSystemAnimationIntent } from '../../../domain/animation/animation-intent';
import type {
  CharacterExpression,
  CharacterTheme,
} from '../../../domain/models/character-visuals';
import {
  DEFAULT_THEMES,
} from '../../../domain/models/character-visuals';
import {
  AssetResolver,
  ManifestLoader,
  type AnimationCompletedEvent,
  type BodyVisualState,
  type RenderPresentationState,
  type SpritePoint,
} from '../../render-engine';
import { useCharacterAnimation } from '../../hooks/useCharacterAnimation';
import { useGaze } from '../../hooks/useGaze';
import type { CursorSample, GazePresentationDirection } from '../../../domain/behavior/gaze-engine';
import type { CursorScreenPosition } from '../../body-ui-runtime';
import { SpriteRenderer, resolveSpriteSource } from './SpriteRenderer';
import { createAnimationPreviewState, type DebugAnimationSelection } from '../../render-engine/animation-preview';
import { createSpriteProjection } from '../../render-engine/sprite-projection';
import type { PupilPoseHandle } from '../../render-engine/pupil-pose';
import { useGazeGeometry } from '../../hooks/useGazeGeometry';
export type { DebugAnimationSelection } from '../../render-engine/animation-preview';

export const BASE_CHARACTER_SIZE = PET_PRESENTATION_LAYOUT.characterRect;

const FALLBACK_INTENT = createSystemAnimationIntent('idle_blink');
const FALLBACK_VISUAL_STATE: BodyVisualState = {
  streamId: 'renderer-fallback',
  revision: 1,
  visualIntent: {
    episodeId: 'renderer-fallback-idle',
    episodeSequence: 1,
    episodeStartedAtMs: 0,
    kind: FALLBACK_INTENT.kind,
    category: FALLBACK_INTENT.category,
    priority: FALLBACK_INTENT.priority,
    interrupt: FALLBACK_INTENT.interrupt,
    loop: FALLBACK_INTENT.loop,
    emotionalTone: FALLBACK_INTENT.emotionalTone,
    ...(FALLBACK_INTENT.expressionHint === undefined
      ? {}
      : { expressionHint: FALLBACK_INTENT.expressionHint }),
    ...(FALLBACK_INTENT.propHint === undefined ? {} : { propHint: FALLBACK_INTENT.propHint }),
  },
  visualAgeMs: 0,
  reflex: {
    pupilOffset: { x: 0, y: 0 },
    transform: { flipX: false, scaleX: 1, scaleY: 1, rotationDeg: 0 },
  },
};

const manifestLoader = new ManifestLoader();
const INITIAL_RESOLVER = new AssetResolver(
  manifestLoader.load({}),
  { enableFaceOverlays: true }
);

let cachedManifestResolver: AssetResolver | null = INITIAL_RESOLVER;

export interface ManifestAnimationRegistry {
  bodyKeys: readonly string[];
  faceKeys: readonly string[];
}

export interface CharacterRendererProps {
  expression?: CharacterExpression;
  theme?: CharacterTheme;
  visualState?: Readonly<BodyVisualState>;
  isDragging?: boolean;
  debugAnimationSelection?: DebugAnimationSelection;
  showAnchorPoint?: boolean;
  onManifestAnimationsLoaded?: (registry: ManifestAnimationRegistry) => void;
  onPresentationChanged?: (state: RenderPresentationState | undefined) => void;
  onAssetLoadError?: (source: string) => void;
  onAnimationCompleted?: (
    event: AnimationCompletedEvent,
    completedVisualEpisodeId: string | undefined
  ) => void;
  onAnimationRejected?: (rejectedVisualEpisodeId: string | undefined) => void;
  onGazeDirectionChanged?: (direction: GazePresentationDirection) => void;
  gazeEnabled?: boolean;
  globalCursor?: CursorSample | null;
  cursorObservationEnabled?: boolean;
  onCursorObserved?: (position: CursorScreenPosition) => void;
  onClick?: () => void;
  onDoubleClick?: () => void;
  onPointerDown?: (event: React.PointerEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}

export const CharacterRenderer: React.FC<CharacterRendererProps> = ({
  expression = 'idle',
  theme = DEFAULT_THEMES.cosmic ?? Object.values(DEFAULT_THEMES)[0]!,
  visualState = FALLBACK_VISUAL_STATE,
  isDragging = false,
  debugAnimationSelection,
  showAnchorPoint = false,
  onManifestAnimationsLoaded,
  onPresentationChanged,
  onAssetLoadError,
  onAnimationCompleted,
  onAnimationRejected,
  onGazeDirectionChanged,
  gazeEnabled = true,
  globalCursor,
  cursorObservationEnabled = true,
  onCursorObserved,
  onClick,
  onDoubleClick,
  onPointerDown,
  onContextMenu,
}) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const pupilPoseRef = useRef<PupilPoseHandle>(null);
  const [resolver, setResolver] = useState<AssetResolver>(() => cachedManifestResolver ?? INITIAL_RESOLVER);
  const debugClip = useMemo(
    () => debugAnimationSelection === undefined
      ? undefined
      : resolver.resolveDebugSelection(debugAnimationSelection.bodyKey, debugAnimationSelection.faceKey),
    [debugAnimationSelection, resolver]
  );
  const playbackState = useMemo(() => debugAnimationSelection === undefined
    ? visualState : createAnimationPreviewState(visualState, debugAnimationSelection),
  [debugAnimationSelection, visualState]);
  const presentationState = useCharacterAnimation(
    resolver,
    playbackState,
    debugClip,
    debugAnimationSelection === undefined ? onAnimationCompleted : undefined,
    debugAnimationSelection === undefined ? onAnimationRejected : undefined
  );
  const renderedSize = BASE_CHARACTER_SIZE;
  const activePresentationState = presentationState;
  useEffect(() => { onPresentationChanged?.(presentationState); }, [onPresentationChanged, presentationState]);

  const faceAnchor = useMemo(() => {
    return getFaceAnchorPoint(activePresentationState);
  }, [activePresentationState]);

  const getGazeGeometry = useGazeGeometry(rootRef, activePresentationState, faceAnchor, renderedSize);

  const handleGazeDirection = useCallback((direction: GazePresentationDirection) => {
    onGazeDirectionChanged?.(direction);
  }, [onGazeDirectionChanged]);

  useGaze({
    enabled: gazeEnabled && debugClip === undefined && faceAnchor !== undefined,
    globalCursor,
    observationEnabled: cursorObservationEnabled,
    getGeometry: getGazeGeometry,
    onGazeDirection: handleGazeDirection,
    onGazeOffset: offset => pupilPoseRef.current?.setPupilOffset(offset),
    onCursorObserved,
    observationLifecycleKey: visualState.streamId,
  });

  useEffect(() => {
    onManifestAnimationsLoaded?.({
      bodyKeys: resolver.getAnimationKeys('body'),
      faceKeys: resolver.getAnimationKeys('face'),
    });
  }, [onManifestAnimationsLoaded, resolver]);

  useEffect(() => {
    let disposed = false;
    if (typeof fetch === 'function') {
      void fetch('./assets/sprites/manifest.json')
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
                    img.src = resolveSpriteSource(frameSrc);
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
      ref={rootRef}
      className={`wisp-character-root ${isDragging ? 'dragging' : ''}`}
      data-testid="wisp-character-root"
      data-wisp-interactive="true"
      data-expression={expression}
      style={{
        width: `${renderedSize.width}px`,
        height: `${renderedSize.height}px`,
        willChange: 'transform',
        filter: `drop-shadow(0 0 16px ${theme.palette.glow})`,
      }}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onPointerDown={onPointerDown}
      onContextMenu={onContextMenu}
    >
      <SpriteRenderer state={activePresentationState} onAssetLoadError={onAssetLoadError} gazeHandle={pupilPoseRef} />
      {showAnchorPoint && faceAnchor && activePresentationState ? (
        <AnchorVisualizer
          anchor={faceAnchor}
          viewport={activePresentationState.viewport}
          rootPivot={activePresentationState.rootPivot}
          renderedSize={renderedSize}
          flipX={activePresentationState.transform.flipX}
          scale={activePresentationState.transform.scale}
          scaleX={activePresentationState.transform.scaleX}
          scaleY={activePresentationState.transform.scaleY}
          rotationDeg={activePresentationState.transform.rotationDeg}
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
  scale?: number;
  scaleX?: number;
  scaleY?: number;
  rotationDeg?: number;
}

export function getFaceAnchorPoint(state: RenderPresentationState | undefined): SpritePoint | undefined {
  const bodyLayer = state?.layers.find((layer) => layer.id === 'base_body');
  const anchor = bodyLayer?.visible ? bodyLayer.frame.anchors?.face : undefined;
  if (state === undefined || bodyLayer === undefined || anchor === undefined) return undefined;
  return { x: state.rootPivot.x + bodyLayer.offset.x + anchor.x - bodyLayer.pivot.x,
    y: state.rootPivot.y + bodyLayer.offset.y + anchor.y - bodyLayer.pivot.y };
}

export function projectAnchorPoint({
  anchor,
  viewport,
  rootPivot,
  renderedSize,
  flipX,
  scale = 1,
  scaleX,
  scaleY,
  rotationDeg,
}: AnchorProjectionInput): SpritePoint {
  return createSpriteProjection({ viewport, rootPivot, renderedSize,
    transform: { flipX, scale, scaleX, scaleY, rotationDeg } })?.project(anchor) ?? rootPivot;
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
