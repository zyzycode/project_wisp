import { expect, it, vi } from 'vitest';
import { MainAutonomyComposition, type MainAutonomyCompositionOptions } from '../../src/main/main-autonomy-composition';
import { CharacterStateService } from '../../src/application/services/character-state.service';
import { createCharacterAutonomySnapshot } from '../../src/domain/character/autonomy-character-engine';

it('consumes the real resolved P4 choice before own-plan claim without fake Explore/SocialBid/visit', () => {
  let now = 0, timerId = 0, draws = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const seed = new CharacterStateService({ now: () => 0 }).getState();
  const character = new CharacterStateService({ now: () => now, initialState: { ...seed,
    needs: { energy: 70, boredom: 90, comfort: 75, play: 0, attention: 0 } } });
  const bounds = { id: 'screen', x: 0, y: 0, width: 1000, height: 800 };
  const claim = vi.fn(() => false), resolved = vi.fn<NonNullable<MainAutonomyCompositionOptions['windowHelp']>['resolved']>(() => true), committed = vi.fn(), social = vi.fn();
  const main = new MainAutonomyComposition({ clock: { now: () => now }, wallNow: () => now,
    scheduler: { setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, at: now + delay }); return id; },
      clearTimeout: handle => { timers.delete(handle as number); } },
    prng: { next: () => ++draws === 1 ? .5 : .999 }, prngMetadata: { algorithm: 'test', seed: 1 },
    getCharacterSnapshot: () => ({ ...createCharacterAutonomySnapshot(character.getState()),
      localTraits: { openness: .8, playfulness: .2, independence: .5, extraversion: .1 } }),
    ownGoals: { opportunity: vi.fn(), selectedGoalKind: () => 'seek_novelty', selectedPlanStep: () => 'explore',
      offerPlanStep: claim, interruptPlanAdmission: vi.fn(), cancel: async () => undefined, invalidate: vi.fn() },
    windowHelp: { eligible: () => true, resolved }, onActivityCommitted: committed, onSocialBidStarted: social,
    movement: { getRootPosition: () => ({ x: 100, y: 790 }), getBounds: () => bounds,
      getEnvironmentSnapshot: () => ({ capturedAtMs: now, screenBounds: bounds,
        currentSurface: { id: 'floor', kind: 'screen_floor', bounds, isValidSupport: true } }),
      getExternalSurfaces: () => [{ id: 'target', kind: 'window_top', bounds: { x: 300, y: 400, width: 300, height: 200 },
        supportY: 400, isValidSupport: true }], getCollisionInsets: () => ({ left: 50, right: 50, top: 90, bottom: 10 }),
      canAcceptVoluntaryMovement: () => true, requestVoluntaryMovement: () => true, cancelVoluntaryMovement: () => false },
    requestManualRootPosition: () => false, createVisualEpisodeId: () => 'visual', onPresentationChanged: vi.fn(),
  });
  main.start();
  for (let attempt = 0; attempt < 10 && !resolved.mock.calls.length; attempt++) {
    const entry = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (!entry) break;
    timers.delete(entry[0]); now = entry[1].at; entry[1].fn();
  }
  expect(resolved, JSON.stringify(main.getDecisionTrace())).toHaveBeenCalledOnce();
  expect(resolved.mock.calls[0]![0]).toMatchObject({ surfaceId: 'target' });
  expect(resolved.mock.calls[0]![1]).toBeGreaterThan(0);
  expect(claim).not.toHaveBeenCalled(); expect(committed).not.toHaveBeenCalled(); expect(social).not.toHaveBeenCalled();
  expect(main.getActivityTimeline()).toBeNull(); main.dispose();
});
