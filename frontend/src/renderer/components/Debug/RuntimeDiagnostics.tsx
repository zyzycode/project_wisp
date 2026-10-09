import { useEffect, useState } from 'react';
import type { BrainStateDTO } from '../../../shared/ipc-contracts';
import type { RenderPresentationState } from '../../render-engine';

export interface RuntimeDiagnosticsProps {
  readonly brain?: BrainStateDTO;
  readonly presentation?: RenderPresentationState;
  readonly assetLoadError?: string;
}

/** Observation only: snapshot silence is not evidence that the Brain stopped. */
export function RuntimeDiagnostics({ brain, presentation, assetLoadError }: RuntimeDiagnosticsProps) {
  const [silentMs, setSilentMs] = useState(0);
  useEffect(() => {
    const observedAt = performance.now();
    setSilentMs(0);
    const timer = setInterval(() => setSilentMs(Math.max(0, performance.now() - observedAt)), 250);
    return () => clearInterval(timer);
  }, [brain?.streamId, brain?.revision]);
  const activity = brain?.activity;
  const playback = presentation?.playback;
  const phaseAge = brain && activity ? Math.max(0, brain.sampledAtMs - activity.phaseStartedAtMs) : null;
  return <section className="debug-hud-state" data-testid="runtime-diagnostics">
    <div className="debug-hud-section-title">Runtime diagnostics</div>
    <div>Episode: {brain?.visualIntent.episodeId ?? '—'}</div>
    <div>Run: {activity?.runId ?? '—'} · step: {activity?.phaseId ?? '—'}</div>
    <div>Phase age at snapshot: {phaseAge === null ? '—' : `${Math.round(phaseAge)} ms`}</div>
    <div>Motion: {brain?.motion.phase ?? '—'} · authority: {brain?.motion.positionAuthority ?? '—'}</div>
    <div>Brain revision: {brain?.revision ?? '—'} · нет обновлений: {Math.round(silentMs)} ms</div>
    <small>С момента наблюдения HUD; дедупликация снимков не означает остановку Brain.</small>
    <div>Clip: {playback?.clipKey ?? '—'} · frame: {playback ? `${playback.frameIndex + 1}/${playback.frameCount}` : '—'}</div>
    <div>Playback: {playback ? playback.completed ? 'completed: terminal frame hold' : 'playing' : 'no presentation'}</div>
    <div>Last asset load error: {assetLoadError ?? 'none'}</div>
  </section>;
}
