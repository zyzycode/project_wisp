import type { BrowserWindow } from 'electron';
import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { ShimejiMotionOrchestrator } from '../../src/application/services/shimeji-motion-orchestrator';
import { PetPositionService } from '../../src/application/services/pet-position.service';
import { MotionEngine } from '../../src/domain/behavior/motion-engine';
import { SurfaceKinematics } from '../../src/domain/behavior/surface-kinematics';
import { ElectronPetPositionAdapter } from '../../src/infrastructure/adapters/electron-pet-position-adapter';
import { calculateWindowRootPivotOffset, PET_PRESENTATION_LAYOUT } from '../../src/shared/pet-presentation-layout';

afterEach(() => vi.useRealTimers());

it.each([
  { id: 'primary', x: 0, y: 0, width: 1920, height: 1080 },
  { id: 'left', x: -1920, y: -200, width: 1920, height: 1080 },
])('keeps scheduled throw/catch responsive across native zero on $id', bounds => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const pivotOffset = calculateWindowRootPivotOffset(PET_PRESENTATION_LAYOUT);
  // Match gin's int32 converter: V8 rejects minus zero even though Number.isInteger accepts it.
  const setPosition = vi.fn((x: number, y: number) => {
    for (const [index, value] of [x, y].entries()) {
      if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647 || Object.is(value, -0)) {
        throw new TypeError(`Error processing argument at index ${index}, conversion failure from`);
      }
    }
  });
  const window = new EventEmitter() as BrowserWindow;
  window.isDestroyed = () => false;
  window.setPosition = setPosition;
  const initialPosition = { x: bounds.x + 500, y: pivotOffset.y + 80 };
  const positionService = new PetPositionService(initialPosition);
  const orchestrator = new ShimejiMotionOrchestrator({
    initialMotion: { phase: 'grounded', position: initialPosition, velocityPxPerSec: { x: 0, y: 0 },
      activeBoundsId: bounds.id, airborneElapsedSec: 0, peakGroundImpactSeverity: 0 },
    initialSurface: { phase: 'grounded', updatedAtMs: 0, locomotionVelocityPxPerSec: { x: 0, y: 0 } },
    motionEngine: new MotionEngine(), surfaceKinematics: new SurfaceKinematics(),
    environment: () => ({ capturedAtMs: Date.now(), screenBounds: bounds }),
    positionService,
    positionPort: new ElectronPetPositionAdapter({ getWindow: () => window, pivotOffset }),
    now: Date.now,
    scheduler: { schedule: callback => {
      const timer = setTimeout(callback, 10);
      return () => clearTimeout(timer);
    } },
  });

  orchestrator.start();
  try {
    for (let cycle = 0; cycle < 20; cycle++) {
      const dragSessionId = orchestrator.beginDrag({ pointerId: 1, sequence: 0,
        screenPosition: orchestrator.getMotionState().position });
      expect(dragSessionId).not.toBeNull();
      if (dragSessionId === null) throw new Error('Catch was rejected');
      vi.advanceTimersByTime(10);
      expect(orchestrator.getMotionState().phase).toBe('dragged');
      const x = initialPosition.x;
      orchestrator.moveDrag({ pointerId: 1, sequence: 1, dragSessionId,
        screenPosition: { x, y: pivotOffset.y + 80 } });
      vi.advanceTimersByTime(20);
      orchestrator.moveDrag({ pointerId: 1, sequence: 2, dragSessionId,
        screenPosition: { x, y: pivotOffset.y - 0.25 } });
      vi.advanceTimersByTime(10);
      expect(setPosition).toHaveBeenLastCalledWith(Math.round(x - pivotOffset.x), 0);
      orchestrator.releaseDrag({ pointerId: 1, sequence: 3, dragSessionId,
        screenPosition: { x, y: pivotOffset.y - 20 } });
      vi.advanceTimersByTime(20);
      const motion = orchestrator.getMotionState();
      expect(motion.phase).toBe('airborne');
      expect(motion.velocityPxPerSec.y).toBeLessThan(0);
      expect(positionService.getRootPosition()).toEqual(motion.position);
    }
    expect(setPosition.mock.calls.some(([, y]) => y < 0)).toBe(true);
  } finally {
    orchestrator.stop();
  }
  const commits = setPosition.mock.calls.length;
  vi.advanceTimersByTime(100);
  expect(setPosition).toHaveBeenCalledTimes(commits);
});
