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

it.each(['missing', 'invalid', 'display'] as const)('does not reacquire a %s candidate during the same release', reason => {
  const landing = new ReleasedWindowLanding(); landing.begin([top], 'screen');
  const live = reason === 'missing' ? []
    : reason === 'invalid' ? [{ ...top, isValidSupport: false }] : [top];
  landing.findLanding({ x: 300, y: 150 }, { x: 300, y: 160 }, live,
    reason === 'display' ? { ...environment, screenBounds: { ...environment.screenBounds, id: 'other' } } : environment, insets);
  expect(landing.findLanding({ x: 300, y: 200 }, { x: 300, y: 300 }, [top], environment, insets)).toBeNull();
});

it('uses live moved/resized geometry of the initial IDs', () => {
  const landing = new ReleasedWindowLanding(); landing.begin([top], 'screen');
  const live = { ...top, bounds: { ...top.bounds, x: 210, y: 300, width: 200 }, supportY: 300 };
  expect(landing.findLanding({ x: 300, y: 200 }, { x: 300, y: 310 }, [live], environment, insets))
    .toMatchObject({ surface: live, root: { x: 300, y: 300 } });
});

it('does not add a newly discovered ID even if it is encountered first', () => {
  const landing = new ReleasedWindowLanding(); landing.begin([top], 'screen');
  const newTop = { ...top, id: 'new', supportY: 220, bounds: { ...top.bounds, y: 220 } };
  expect(landing.findLanding({ x: 300, y: 200 }, { x: 300, y: 300 }, [newTop, top], environment, insets)?.surface.id).toBe('top');
});

it('permanently removes geometry that jumps above the root', () => {
  const landing = new ReleasedWindowLanding(); landing.begin([top], 'screen');
  const above = { ...top, supportY: 150, bounds: { ...top.bounds, y: 150 } };
  expect(landing.findLanding({ x: 300, y: 200 }, { x: 300, y: 210 }, [above], environment, insets)).toBeNull();
  expect(landing.findLanding({ x: 300, y: 210 }, { x: 300, y: 300 }, [top], environment, insets)).toBeNull();
});

it('resolves equal top contacts by ID and gives an equal floor contact to the floor', () => {
  const landing = new ReleasedWindowLanding();
  const earlierId = { ...top, id: 'aaa' };
  landing.begin([top, earlierId], 'screen');
  expect(landing.findLanding({ x: 300, y: 200 }, { x: 300, y: 300 }, [top, earlierId], environment, insets)?.surface.id).toBe('aaa');
  const floorTop = { ...top, supportY: 790, bounds: { ...top.bounds, y: 790 } };
  landing.begin([floorTop], 'screen');
  expect(landing.findLanding({ x: 300, y: 780 }, { x: 300, y: 810 }, [floorTop], environment, insets)).toBeNull();
  const aboveFloor = { ...top, supportY: 785, bounds: { ...top.bounds, y: 785 } };
  expect(landing.findLanding({ x: 300, y: 780 }, { x: 300, y: 790 }, [aboveFloor], environment, insets)).toBeNull();
});

it('clears the episode on same-ID screen topology changes', () => {
  const landing = new ReleasedWindowLanding(); landing.begin([top], 'screen', environment.screenBounds);
  expect(landing.findLanding({ x: 300, y: 200 }, { x: 300, y: 220 }, [top],
    { ...environment, screenBounds: { ...environment.screenBounds, width: 900 } }, insets)).toBeNull();
  expect(landing.findLanding({ x: 300, y: 220 }, { x: 300, y: 300 }, [top], environment, insets)).toBeNull();
});

it('uses the swept x before a wall/floor clamp and rejects contact outside root bounds', () => {
  const landing = new ReleasedWindowLanding();
  const edgeTop = { ...top, bounds: { x: 800, y: 785, width: 200, height: 300 }, supportY: 785 };
  landing.begin([edgeTop], 'screen');
  // At top height x=910. A clamped endpoint at (950,790) would incorrectly yield x=925.
  expect(landing.findLanding({ x: 900, y: 780 }, { x: 1000, y: 830 }, [edgeTop], environment, insets)?.root)
    .toEqual({ x: 910, y: 785 });
  landing.begin([edgeTop], 'screen');
  expect(landing.findLanding({ x: 950, y: 780 }, { x: 1000, y: 790 }, [edgeTop], environment, insets)).toBeNull();
});
