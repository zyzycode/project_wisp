import { expect, it, vi } from 'vitest';
import { MainInitiativeComposition } from '../../src/main/main-initiative-composition';
import { InitiativeBudget } from '../../src/application/services/initiative-budget';
import { selectWindowTopForRelease } from '../../src/domain/behavior/external-surface-support';
import type { ExplorePlan } from '../../src/domain/behavior/explore-planner';
import type { ExternalWindowSurface } from '../../src/domain/behavior/surface-kinematics';
import { selectExplorePlan } from '../../src/domain/behavior/explore-planner';
it('verifies manual targets using exact existing release support acceptance, including environment collision rejection', async () => {
  const screen = { id: 'screen', x: 0, y: 0, width: 1000, height: 800 };
  const insets = { left: 50, right: 50, top: 90, bottom: 10 };
  const surface: ExternalWindowSurface = { id: 'target', kind: 'window_top', bounds: {
    x: 300, y: 400, width: 300, height: 200 }, supportY: 400, isValidSupport: true };
  let current = surface;
  const main = new MainInitiativeComposition({ now: () => 0, streamId: () => 's', createId: () => 'r', generation: () => 0,
    events: () => undefined, publish: vi.fn(), conditions: () => ({ memory: true, quiet: false, sleeping: false, away: false, busy: false }),
    needs: () => ({ boredom: 80, energy: 70 }), noCausal: () => true, manualPresenceActive: () => true,
    screen: () => screen, insets: () => insets });
  main.configure(true);
  await main.controls.setConsent({ streamId: 's', profileGeneration: 0, enabled: true });
  const attach = () => main.attach({ getInitiativeBudget: () => new InitiativeBudget() }, {
    getSnapshot: () => ({ capability: 'available', revision: 1, capturedAtMs: 0, surfaces: [current] }),
    subscribe: () => () => undefined, dispose: vi.fn(),
  });
  const plan = (): ExplorePlan => {
    const result = selectExplorePlan({ currentRootPosition: { x: 100, y: 790 },
      environment: { capturedAtMs: 0, screenBounds: screen, currentSurface: { id: 'floor', kind: 'screen_floor', bounds: screen, isValidSupport: true } },
      collisionInsets: insets, needs: { energy: 70, attention: 0, play: 0, comfort: 70, boredom: 80 },
      tone: 'neutral', history: { entries: [] }, nowMs: 0, externalSurfaces: [surface] }, .999);
    if (!result) throw Error('Expected existing Explore target'); return result;
  };
  attach(); expect(main.eligible(plan())).toBe(true);
  expect(selectWindowTopForRelease([current], { x: 450, y: 400 }, () => ({ capturedAtMs: 0, screenBounds: screen }), insets)?.id).toBe('target');
  current = { ...surface, bounds: { ...surface.bounds, y: 20 }, supportY: 20 };
  attach(); expect(main.eligible(plan())).toBe(false);
  expect(selectWindowTopForRelease([current], { x: 450, y: 20 }, () => ({ capturedAtMs: 0, screenBounds: screen }), insets)).toBeNull();
  main.dispose();
});
