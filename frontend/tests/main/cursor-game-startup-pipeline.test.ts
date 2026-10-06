import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { MainAutonomyComposition } from '../../src/main/main-autonomy-composition';
import { initialPetWindowPosition } from '../../src/main/initial-pet-position';
import { ShimejiMotionOrchestrator } from '../../src/application/services/shimeji-motion-orchestrator';
import { CharacterStateService } from '../../src/application/services/character-state.service';
import { ShimejiStimulusMapper } from '../../src/application/services/shimeji-stimulus.mapper';
import { DEFAULT_MOTION_CONSTRAINTS, MotionEngine } from '../../src/domain/behavior/motion-engine';
import { SurfaceKinematics } from '../../src/domain/behavior/surface-kinematics';
import { nativeToRootPosition } from '../../src/infrastructure/adapters/electron-pet-position-adapter';
import { SeededPrng } from '../../src/infrastructure/random/seeded-prng';
import { PET_PRESENTATION_LAYOUT, calculateWindowRootPivotOffset } from '../../src/shared/pet-presentation-layout';
import { parseBrainStateDTO } from '../../src/shared/brain-body-ipc-validation';
import { toBrainStateDTO } from '../../src/main/mappers/shimeji-ipc.mapper';
import { PetBodyController } from '../../src/renderer/pet-body-controller';
import { AssetResolver, ManifestLoader, SpriteSkinAdapter } from '../../src/renderer/render-engine';
import type { ActivityOutcomeFeedback } from '../../src/application/ports/shimeji-feedback-port';

afterEach(() => vi.useRealTimers());
it('runs startup → global observation → real Motion chase → caught → registered Skin clip with production defaults', () => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  const bounds = { id: 'screen', x: 0, y: 0, width: 1920, height: 1040 };
  const root = nativeToRootPosition(initialPetWindowPosition(bounds), calculateWindowRootPivotOffset(PET_PRESENTATION_LAYOUT));
  let cursor = { x: root.x - 40, y: root.y };
  let main: MainAutonomyComposition, sequence = 0, revision = 0;
  const character = new CharacterStateService({ now: Date.now });
  const mapper = new ShimejiStimulusMapper(), outcomes: ActivityOutcomeFeedback[] = [];
  const motion = new ShimejiMotionOrchestrator({
    initialMotion: { phase: 'grounded', position: root, velocityPxPerSec: { x: 0, y: 0 }, activeBoundsId: bounds.id,
      airborneElapsedSec: 0, peakGroundImpactSeverity: 0 },
    initialSurface: { phase: 'grounded', updatedAtMs: 0, locomotionVelocityPxPerSec: { x: 0, y: 0 } },
    motionEngine: new MotionEngine(), surfaceKinematics: new SurfaceKinematics(), now: Date.now,
    environment: () => ({ capturedAtMs: Date.now(), screenBounds: bounds,
      currentSurface: { id: 'floor', kind: 'screen_floor', bounds, isValidSupport: true } }),
    positionPort: { commitRootPosition: () => {} },
    eventDispatcher: { dispatchMotionEvent: event => main.handleMotionEvent(event), dispatchSurfaceEvent: () => {} },
    onVoluntaryMovementCompleted: done => main.notifyVoluntaryMovementCompleted(done),
  });
  main = new MainAutonomyComposition({ clock: { now: Date.now },
    scheduler: { setTimeout, clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) },
    prng: new SeededPrng(0x57535031), prngMetadata: { algorithm: 'xorshift32', seed: 0x57535031 },
    cursorPosition: { getCursorScreenPosition: () => cursor }, getCharacterSnapshot: () => character.getSnapshot(),
    tickNeeds: ms => { character.tickNeeds(ms); },
    onActivityOutcome: outcome => { outcomes.push(outcome); const stimulus = mapper.map(outcome,
      { createdAtIso: new Date().toISOString(), landingThresholds: DEFAULT_MOTION_CONSTRAINTS });
      if (stimulus) character.applyStimulus(stimulus); },
    movement: { getRootPosition: () => motion.getMotionState().position, getBounds: () => bounds,
      getEnvironmentSnapshot: () => motion.getEnvironmentSnapshot(), getCollisionInsets: () => DEFAULT_MOTION_CONSTRAINTS.collisionInsets,
      canAcceptVoluntaryMovement: () => motion.canAcceptVoluntaryMovement(),
      requestVoluntaryMovement: command => motion.requestVoluntaryMovement(command),
      cancelVoluntaryMovement: drag => motion.cancelVoluntaryMovement(drag) },
    requestManualRootPosition: () => false, createVisualEpisodeId: () => `visual-${++sequence}`,
    createActivityRunId: () => `run-${++sequence}`, onPresentationChanged: () => {},
  });
  const body = new PetBodyController({ onBrainState: () => () => {}, postBodyEvent: async () => {} }, Date.now);
  const seenClips = new Set<string>();
  const skin = new SpriteSkinAdapter({ resolver: new AssetResolver(new ManifestLoader().load(
    JSON.parse(readFileSync(resolve('public/assets/sprites/manifest.json'), 'utf8')))),
    scheduler: { request: () => 1, cancel: () => {} }, createRenderer: () => ({ destroy: () => {},
      render: state => { const key = state.layers[0]?.animationKey; if (key) seenClips.add(key); } }) });
  const advance = () => {
    vi.advanceTimersByTime(10); motion.tick(); main.tick();
    const state = parseBrainStateDTO(toBrainStateDTO({ streamId: 'stream', revision: ++revision, sampledAtMs: Date.now(),
      character: character.getSnapshot(), dialogue: { conversationId: 'c', canSubmit: true, turn: { phase: 'idle' } },
      autonomy: main.getAutonomyMode(), cursorGame: main.getCursorGamePresentation(), activity: main.getActivityTimeline(),
      motion: motion.getMotionState(), visualEpisode: main.getVisualEpisode() }));
    skin.update(body.acceptBrainState(state)!.visual);
  };
  try {
    motion.start(); main.start(); skin.init();
    for (let i = 0; i < 200 && main.getActivityTimeline()?.activityId !== 'cursor_interest'; i++) advance();
    expect(main.getActivityTimeline()?.activityId).toBe('cursor_interest');
    cursor = { x: root.x - 120, y: root.y };
    for (let i = 0; i < 600 && !outcomes.some(outcome => outcome.family === 'cursor_interest'); i++) advance();
    expect(root.x - motion.getMotionState().position.x).toBeGreaterThan(90);
    expect(outcomes.filter(outcome => outcome.family === 'cursor_interest')).toMatchObject([{ outcome: 'completed', playCompleted: true }]);
    expect(seenClips.has('body_walk')).toBe(true);
    expect(seenClips.has('body_cursor_play')).toBe(true);
    expect(seenClips.has('body_cursor_caught')).toBe(true);
    expect(character.getState().relationship.friendship).toBe(0);
  } finally { main.dispose(); motion.stop(); skin.destroy(); }
});
