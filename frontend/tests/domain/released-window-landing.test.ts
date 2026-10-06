import { expect, it } from 'vitest';
import { ReleasedWindowLanding } from '../../src/domain/behavior/released-window-landing';
import { DEFAULT_MOTION_CONSTRAINTS } from '../../src/domain/behavior/motion-engine';
import type { ExternalWindowSurface } from '../../src/domain/behavior/surface-kinematics';

const top: ExternalWindowSurface = { id: 'top', kind: 'window_top', bounds: { x: 200, y: 250, width: 300, height: 300 }, supportY: 250, isValidSupport: true };
const environment = { capturedAtMs: 0, screenBounds: { id: 'screen', x: 0, y: 0, width: 1000, height: 800 } };
const insets = DEFAULT_MOTION_CONSTRAINTS.collisionInsets;

it('uses the first swept contact instead of tunneling through two window tops', () => {
  const lower: ExternalWindowSurface = { ...top, id: 'lower', bounds: { ...top.bounds, y: 350 }, supportY: 350 };
  const landing = new ReleasedWindowLanding(); landing.begin([lower, top], 'screen');
  expect(landing.findLanding({ x: 300, y: 200 }, { x: 700, y: 400 }, [lower, top], environment, insets))
    .toMatchObject({ surface: top, root: { x: 400, y: 250 } });
  expect(landing.findLanding({ x: 300, y: 200 }, { x: 300, y: 400 }, [top], environment, insets)).toBeNull();
});

it('ignores upward crossings and falling beside the window', () => {
  const landing = new ReleasedWindowLanding(); landing.begin([top], 'screen');
  expect(landing.findLanding({ x: 300, y: 300 }, { x: 300, y: 200 }, [top], environment, insets)).toBeNull();
  expect(landing.findLanding({ x: 100, y: 200 }, { x: 100, y: 300 }, [top], environment, insets)).toBeNull();
});

it.each(['missing', 'moved', 'invalid', 'display'] as const)('does not reacquire a %s candidate during the same release', reason => {
  const landing = new ReleasedWindowLanding(); landing.begin([top], 'screen');
  const live = reason === 'missing' ? [] : reason === 'moved' ? [{ ...top, bounds: { ...top.bounds, x: 210 } }]
    : reason === 'invalid' ? [{ ...top, isValidSupport: false }] : [top];
  landing.findLanding({ x: 300, y: 150 }, { x: 300, y: 160 }, live,
    reason === 'display' ? { ...environment, screenBounds: { ...environment.screenBounds, id: 'other' } } : environment, insets);
  expect(landing.findLanding({ x: 300, y: 200 }, { x: 300, y: 300 }, [top], environment, insets)).toBeNull();
});
