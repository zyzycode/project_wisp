import React from 'react';
import type { DebugLogEntryDTO, PetPositionDTO } from '../../../shared/ipc-contracts';
import type { AnimationExpressionHint, AnimationIntent } from '../../../domain/animation/animation-intent';
import type { AnimationEvent, AnyAnimationState } from '../../../domain/animation/animation-state-machine';
import type { Needs, Relationship, SynthesizedEmotionalTone } from '../../../domain/character/types';
import { LogViewer } from './LogViewer';
import { NeedsIndicator } from './NeedsIndicator';
import { AnimationInspector } from './AnimationInspector';

export interface DebugHUDProps {
  needs: Needs;
  relationship: Relationship;
  tone: SynthesizedEmotionalTone;
  animationState: AnyAnimationState;
  animationIntent: AnimationIntent;
  fps: number;
  logs: readonly DebugLogEntryDTO[];
  position?: PetPositionDTO;
  isWandering?: boolean;
  flipX?: boolean;
  currentFace?: AnimationExpressionHint | null;
  bodyAnimationKeys?: readonly string[];
  faceAnimationKeys?: readonly string[];
  selectedBodyAnimationKey?: string | null;
  selectedFaceAnimationKey?: string | null;
  showAnchorPoint?: boolean;
  onClearLogs: () => void;
  onPlayAnimation?: (anim: AnimationEvent) => void;
  onSelectFace?: (face: AnimationExpressionHint | null) => void;
  onSelectBodyAnimation?: (key: string | null) => void;
  onSelectManifestFace?: (key: string | null) => void;
  onToggleAnchorPoint?: () => void;
}

const ANIMATION_BUTTONS: { event: AnimationEvent; label: string }[] = [
  { event: 'SETTLE', label: 'body_idle' },
  { event: 'START_FLOAT', label: 'body_walk' },
  { event: 'PET', label: 'body_petting' },
  { event: 'WAVE', label: 'body_wave' },
  { event: 'CELEBRATE', label: 'body_celebrate' },
  { event: 'THINK', label: 'body_thinking' },
  { event: 'SPOOK', label: 'body_scared' },
  { event: 'BORED', label: 'body_bored' },
  { event: 'START_SLEEP', label: 'body_sleep_trans' },
  { event: 'WAKE_UP', label: 'body_land' },
  { event: 'START_DRAG', label: 'body_dragged' },
  { event: 'LAND', label: 'body_land' },
];

const FACE_BUTTONS: { face: AnimationExpressionHint | null; label: string }[] = [
  { face: null, label: 'auto' },
  { face: 'happy', label: 'face_happy' },
  { face: 'sad', label: 'face_sad' },
  { face: 'shocked', label: 'face_shocked' },
  { face: 'sleepy', label: 'face_sleep' },
  { face: 'talking', label: 'face_talking' },
  { face: 'thinking', label: 'face_thinking' },
  { face: 'angry', label: 'face_angry' },
];

function relationshipLevel(friendship: number): string {
  if (friendship >= 750) return 'close';
  if (friendship >= 300) return 'trusted';
  if (friendship > 0) return 'acquaintance';
  return 'new';
}

export const DebugHUD: React.FC<DebugHUDProps> = ({
  needs,
  relationship,
  tone,
  animationState,
  animationIntent,
  fps,
  logs,
  position,
  isWandering = false,
  flipX = false,
  currentFace = null,
  bodyAnimationKeys = [],
  faceAnimationKeys = [],
  selectedBodyAnimationKey = null,
  selectedFaceAnimationKey = null,
  showAnchorPoint = false,
  onClearLogs,
  onPlayAnimation,
  onSelectFace,
  onSelectBodyAnimation,
  onSelectManifestFace,
  onToggleAnchorPoint,
}) => {
  return (
    <section className="debug-hud" data-testid="debug-hud">
      <header className="debug-hud-header">
        <strong>✨ Wisp Debug</strong>
        <span>{Math.round(fps)} FPS</span>
      </header>

      <NeedsIndicator needs={needs} />

      <section className="debug-hud-relationship">
        <div className="debug-hud-section-title">❤️ Relationship</div>
        <div>💖 Friendship: {Math.round(relationship.friendship)} · {relationshipLevel(relationship.friendship)}</div>
        <div>Love: {relationship.loveUnlocked ? 'unlocked' : 'locked'} ({Math.round(relationship.love)})</div>
      </section>

      <section className="debug-hud-state">
        <div className="debug-hud-section-title">🎭 Animation & FSM</div>
        <div>🎭 Tone: <strong>{tone}</strong></div>
        <div>⚙️ FSM: <strong>{animationState}</strong></div>
        <div>🎯 Intent: <strong>{animationIntent.kind}</strong> ({animationIntent.loop})</div>
        <div>👁️ Expression: <strong>{animationIntent.expressionHint ?? 'default'}</strong></div>
      </section>

      {position ? (
        <section className="debug-hud-state">
          <div className="debug-hud-section-title">📍 Spatial & Motion</div>
          <div>Coords: <strong>X: {Math.round(position.x)}, Y: {Math.round(position.y)}</strong></div>
          <div>State: <strong>{isWandering ? 'Walking' : 'Resting'}</strong></div>
          <div>Heading: <strong>{flipX ? 'Left' : 'Right'}</strong></div>
        </section>
      ) : null}

      {onSelectBodyAnimation && onSelectManifestFace && onToggleAnchorPoint ? (
        <AnimationInspector
          bodyAnimationKeys={bodyAnimationKeys}
          faceAnimationKeys={faceAnimationKeys}
          selectedBodyKey={selectedBodyAnimationKey}
          selectedFaceKey={selectedFaceAnimationKey}
          showAnchorPoint={showAnchorPoint}
          onSelectBody={onSelectBodyAnimation}
          onSelectFace={onSelectManifestFace}
          onToggleAnchorPoint={onToggleAnchorPoint}
        />
      ) : null}

      {onSelectFace ? (
        <section className="debug-hud-animations">
          <div className="debug-hud-section-title">🎭 Выражения лица</div>
          <div className="debug-anim-btn-grid">
            {FACE_BUTTONS.map((item) => (
              <button
                key={item.label}
                type="button"
                className={`debug-anim-btn ${currentFace === item.face ? 'active' : ''}`}
                onClick={() => onSelectFace(item.face)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {onPlayAnimation ? (
        <section className="debug-hud-animations">
          <div className="debug-hud-section-title">🎬 Проигрывание анимаций</div>
          <div className="debug-anim-btn-grid">
            {ANIMATION_BUTTONS.map((item) => (
              <button
                key={item.event}
                type="button"
                className="debug-anim-btn"
                onClick={() => onPlayAnimation(item.event)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <LogViewer logs={logs} onClear={onClearLogs} />
    </section>
  );
};
