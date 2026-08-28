import React from 'react';
import type { DebugLogEntryDTO, PetPositionDTO } from '../../../shared/ipc-contracts';
import type { AnimationIntent } from '../../../domain/animation/animation-intent';
import type { AnimationState } from '../../../domain/animation/animation-state-machine';
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
  mood?: string;
  onClearLogs: () => void;
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
  mood,
  onClearLogs,
}) => {
  return (
    <section className="debug-hud" data-testid="debug-hud">
      <header className="debug-hud-header">
        <strong>✨ Wisp Debug</strong>
        <span>{Math.round(fps)} FPS</span>
      </header>

      <NeedsIndicator needs={needs} />

      <section className="debug-hud-state">
        <div className="debug-hud-section-title">🎬 Animation & FSM</div>
        <div>🎭 Tone: <strong>{tone}</strong> {mood ? `· Mood: ${mood}` : ''}</div>
        <div>⚙️ FSM: <strong>{animationState}</strong></div>
        <div>🎯 Intent: <strong>{animationIntent.kind}</strong> ({animationIntent.loop})</div>
        <div>👁️ Expression: <strong>{animationIntent.expressionHint ?? 'default'}</strong></div>
      </section>

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
