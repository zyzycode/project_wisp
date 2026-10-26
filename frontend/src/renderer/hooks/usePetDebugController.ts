import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import type { DebugTelemetryDTO, WispApiBridge } from '../../shared/ipc-contracts';
import type {
  DebugAnimationSelection,
  ManifestAnimationRegistry,
} from '../components/Character/CharacterRenderer';

const EMPTY_DEBUG_TELEMETRY: DebugTelemetryDTO = {
  character: {
    needs: { energy: 0, attention: 0, play: 0, comfort: 0 },
    relationship: { friendship: 0, love: 0, loveUnlocked: false },
    synthesizedTone: 'neutral',
    lastUpdated: 0,
  },
  logs: [],
};

interface UsePetDebugControllerOptions {
  readonly bridge: WispApiBridge;
  readonly menuOpen: boolean;
  readonly setMenuOpen: Dispatch<SetStateAction<boolean>>;
  readonly debugHudVisible: boolean;
  readonly setDebugHudVisible: Dispatch<SetStateAction<boolean>>;
}

/** Owns debug telemetry and preview presentation; HUD visibility also controls the overlay. */
export function usePetDebugController({
  bridge, menuOpen, setMenuOpen, debugHudVisible, setDebugHudVisible,
}: UsePetDebugControllerOptions) {
  const debugHudEnabled = bridge.debugEnabled;
  const [manifestAnimations, setManifestAnimations] = useState<ManifestAnimationRegistry>({
    bodyKeys: [],
    faceKeys: [],
  });
  const [inspectorBodyKey, setInspectorBodyKey] = useState<string | null>(null);
  const [inspectorFaceKey, setInspectorFaceKey] = useState<string | null>(null);
  const [previewLoop, setPreviewLoop] = useState(true);
  const [previewReplayToken, setPreviewReplayToken] = useState(0);
  const [showAnchorPoint, setShowAnchorPoint] = useState(false);
  const [debugTelemetry, setDebugTelemetry] = useState(EMPTY_DEBUG_TELEMETRY);
  const [renderFps, setRenderFps] = useState(0);

  const debugAnimationSelection = useMemo<DebugAnimationSelection | undefined>(() => {
    if (!menuOpen || inspectorBodyKey === null) return undefined;
    return {
      bodyKey: inspectorBodyKey,
      replayToken: previewReplayToken,
      loop: previewLoop,
      ...(inspectorFaceKey === null ? {} : { faceKey: inspectorFaceKey }),
    };
  }, [inspectorBodyKey, inspectorFaceKey, menuOpen, previewReplayToken, previewLoop]);

  useEffect(() => {
    if (!menuOpen) {
      setInspectorBodyKey(null);
      setInspectorFaceKey(null);
    }
  }, [menuOpen]);

  const selectPreviewBody = useCallback((key: string | null) => {
    setMenuOpen(true);
    setInspectorBodyKey(key);
    if (key === null) setInspectorFaceKey(null);
    setPreviewReplayToken(value => value + 1);
  }, [setMenuOpen]);

  const selectPreviewFace = useCallback((key: string | null) => {
    setMenuOpen(true);
    setInspectorFaceKey(key);
    if (key !== null) setInspectorBodyKey(current => current ?? 'body_idle');
    setPreviewReplayToken(value => value + 1);
  }, [setMenuOpen]);

  const clearPreview = useCallback(() => {
    setInspectorBodyKey(null);
    setInspectorFaceKey(null);
  }, []);

  useEffect(() => {
    if (!debugHudEnabled || (!debugHudVisible && !menuOpen)) return undefined;
    const getDebugTelemetry = bridge.getDebugTelemetry;
    const onDebugTelemetry = bridge.onDebugTelemetry;
    if (getDebugTelemetry === undefined || onDebugTelemetry === undefined) return undefined;
    let active = true;
    const refreshTelemetry = (): void => {
      void getDebugTelemetry()
        .then((telemetry) => {
          if (active) setDebugTelemetry(telemetry);
        })
        .catch(() => undefined);
    };
    refreshTelemetry();
    const unsubscribe = onDebugTelemetry((telemetry) => {
      if (active) setDebugTelemetry(telemetry);
    });
    const intervalId = window.setInterval(refreshTelemetry, 1_000);
    return (): void => {
      active = false;
      window.clearInterval(intervalId);
      unsubscribe();
    };
  }, [bridge, debugHudEnabled, debugHudVisible, menuOpen]);

  useEffect(() => {
    if (!debugHudEnabled) return undefined;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        setDebugHudVisible((visible) => !visible);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return (): void => window.removeEventListener('keydown', handleKeyDown);
  }, [debugHudEnabled, setDebugHudVisible]);

  useEffect(() => {
    if (!debugHudVisible && !menuOpen) return undefined;
    let frameId = 0;
    let frames = 0;
    let sampleStartedAt = performance.now();
    const sample = (now: number): void => {
      frames += 1;
      const elapsedMs = now - sampleStartedAt;
      if (elapsedMs >= 500) {
        setRenderFps(Math.round((frames * 1_000) / elapsedMs));
        frames = 0;
        sampleStartedAt = now;
      }
      frameId = window.requestAnimationFrame(sample);
    };
    frameId = window.requestAnimationFrame(sample);
    return (): void => window.cancelAnimationFrame(frameId);
  }, [debugHudVisible, menuOpen]);

  return {
    debugAnimationSelection, showAnchorPoint, manifestAnimations, setManifestAnimations,
    debugTelemetry, renderFps, inspectorBodyKey, inspectorFaceKey, previewLoop,
    selectPreviewBody, selectPreviewFace, clearPreview, setShowAnchorPoint,
    togglePreviewLoop: () => { setPreviewLoop(value => !value); setPreviewReplayToken(value => value + 1); },
    replayPreview: () => setPreviewReplayToken(value => value + 1),
    clearDebugLogs: () => {
      if (bridge.clearDebugTelemetryLogs !== undefined) void bridge.clearDebugTelemetryLogs();
    },
  };
}
