import React, { useRef, useState } from 'react';
import type { DebugLogEntryDTO } from '../../../shared/ipc-contracts';
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
  onClearLogs,
}) => {
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ readonly pointerX: number; readonly pointerY: number; readonly x: number; readonly y: number } | null>(null);

  return (
    <aside
      className="debug-hud backdrop-blur-md bg-black/75 border border-white/10 rounded-xl p-3 text-xs"
      data-testid="debug-hud"
      style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
      onPointerDown={(event) => {
        dragRef.current = { pointerX: event.clientX, pointerY: event.clientY, x: position.x, y: position.y };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (drag === null) return;
        setPosition({ x: drag.x + event.clientX - drag.pointerX, y: drag.y + event.clientY - drag.pointerY });
      }}
      onPointerUp={() => { dragRef.current = null; }}
    >
      <header className="debug-hud-header">
        <strong>Wisp Debug</strong>
        <span>{Math.round(fps)} FPS</span>
      </header>
      <NeedsIndicator needs={needs} />
      <section className="debug-hud-relationship">
        <div className="debug-hud-section-title">Relationship</div>
        <div>💖 Friendship: {Math.round(relationship.friendship)} · {relationshipLevel(relationship.friendship)}</div>
        <div>Love: {relationship.loveUnlocked ? 'unlocked' : 'locked'} ({Math.round(relationship.love)})</div>
      </section>
      <section className="debug-hud-state">
        <div className="debug-hud-section-title">Emotion & animation</div>
        <div>🎭 Tone: <strong>{tone}</strong></div>
        <div>FSM: <strong>{animationState}</strong></div>
        <div>Intent: <strong>{animationIntent.kind}</strong> · {animationIntent.loop}</div>
      </section>
      <LogViewer logs={logs} onClear={onClearLogs} />
    </aside>
  );
};

function relationshipLevel(friendship: number): string {
  if (friendship >= 750) return 'close';
  if (friendship >= 300) return 'trusted';
  if (friendship > 0) return 'acquaintance';
  return 'new';
}
