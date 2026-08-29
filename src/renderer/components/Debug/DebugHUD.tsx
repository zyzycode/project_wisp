import React from 'react';
import type { DebugLogEntryDTO, PetPositionDTO } from '../../../shared/ipc-contracts';
import type { AnimationExpressionHint, AnimationIntent } from '../../../domain/animation/animation-intent';
import type { AnimationEvent, AnimationState } from '../../../domain/animation/animation-state-machine';
import type { Needs, Relationship, SynthesizedEmotionalTone } from '../../../domain/character/types';
import { LogViewer } from './LogViewer';
import { NeedsIndicator } from './NeedsIndicator';

export interface DebugHUDProps {
  needs: Needs;
  relationship: Relationship;
  tone: SynthesizedEmotionalTone;
  animationState: AnimationState;
  animationIntent: AnimationIntent;
  fps: number;
  logs: readonly DebugLogEntryDTO[];
  position?: PetPositionDTO;
  isWandering?: boolean;
  flipX?: boolean;
  currentFace?: AnimationExpressionHint | null;
  onClearLogs: () => void;
  onPlayAnimation?: (anim: AnimationEvent) => void;
  onSelectFace?: (face: AnimationExpressionHint | null) => void;
}

const ANIMATION_BUTTONS: { event: AnimationEvent; label: string }[] = [
  { event: 'SETTLE', label: '🌿 Дыхание (Idle)' },
  { event: 'START_FLOAT', label: '🐾 Ходьба (Walk)' },
  { event: 'PET', label: '💖 Радость (Happy)' },
  { event: 'WAVE', label: '👋 Привет (Wave)' },
  { event: 'CELEBRATE', label: '🎉 Праздник (Party)' },
  { event: 'THINK', label: '💡 Мысли (Think)' },
  { event: 'SPOOK', label: '😲 Испуг (Scared)' },
  { event: 'BORED', label: '🥱 Скука (Bored)' },
  { event: 'START_SLEEP', label: '🌙 Сон (Sleep)' },
  { event: 'WAKE_UP', label: '☀️ Подъём (Wake)' },
  { event: 'START_DRAG', label: '🪁 Полёт (Drag)' },
  { event: 'LAND', label: '🛫 Посадка (Land)' },
];

const FACE_BUTTONS: { face: AnimationExpressionHint | null; label: string }[] = [
  { face: null, label: '🔄 Авто' },
  { face: 'happy', label: '😊 Радость' },
  { face: 'sad', label: '😢 Грусть' },
  { face: 'shocked', label: '😲 Шок' },
  { face: 'sleepy', label: '😴 Сон' },
  { face: 'talking', label: '💬 Речь' },
  { face: 'thinking', label: '🤔 Мысли' },
  { face: 'angry', label: '😠 Злость' },
];

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
  onClearLogs,
  onPlayAnimation,
  onSelectFace,
}) => {
  return (
    <section className="debug-hud" data-testid="debug-hud">
      <header className="debug-hud-header">
        <strong>✨ Wisp Debug</strong>
        <span>{Math.round(fps)} FPS</span>
      </header>

      <NeedsIndicator needs={needs} />

      <section className="debug-hud-state">
        <div className="debug-hud-section-title">🎭 Animation & FSM</div>
        <div>🎭 Tone: <strong>{tone}</strong></div>
        <div>⚙️ FSM: <strong>{animationState}</strong></div>
        <div>🎯 Intent: <strong>{animationIntent.kind}</strong> ({animationIntent.loop})</div>
        <div>👁️ Expression: <strong>{animationIntent.expressionHint ?? 'default'}</strong></div>
      </section>

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

      {position ? (
        <section className="debug-hud-state">
          <div className="debug-hud-section-title">📍 Spatial & Motion</div>
          <div>Coords: <strong>X: {Math.round(position.x)}, Y: {Math.round(position.y)}</strong></div>
          <div>Movement: <strong>{isWandering ? '🚶 Walking' : '🧍 Idle Standing'}</strong></div>
          <div>Facing: <strong>{flipX ? '⬅️ Left' : '➡️ Right'}</strong></div>
        </section>
      ) : null}

      <section className="debug-hud-relationship">
        <div className="debug-hud-section-title">💖 Relationship & Bond</div>
        <div>🤝 Friendship: {Math.round(relationship.friendship)} · {relationshipLevel(relationship.friendship)}</div>
        <div>🔒 Love: {relationship.loveUnlocked ? 'unlocked' : 'locked'} ({Math.round(relationship.love)})</div>
      </section>

      <LogViewer logs={logs} onClear={onClearLogs} />
    </section>
  );
};

function relationshipLevel(friendship: number): string {
  if (friendship >= 750) return 'close';
  if (friendship >= 300) return 'trusted';
  if (friendship > 0) return 'acquaintance';
  return 'new';
}
