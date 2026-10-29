import { describe, expect, it } from 'vitest';
import { planChatWalk, type ChatWalkPlanningInput } from '../../src/domain/behavior/chat-walk';
import { validateActivityDefinition } from '../../src/domain/behavior/activity-runner';

function input(overrides: Partial<ChatWalkPlanningInput> = {}): ChatWalkPlanningInput {
  return {
    direction: 'left', root: { x: 500, y: 790 }, nowMs: 1000,
    collisionInsets: { left: 50, right: 50, top: 90, bottom: 10 },
    environment: { capturedAtMs: 1000,
      screenBounds: { id: 'screen', x: 0, y: 0, width: 1000, height: 800 },
      currentSurface: { id: 'floor', kind: 'screen_floor', isValidSupport: true,
        bounds: { x: 0, y: 0, width: 1000, height: 800 } } },
    ...overrides,
  };
}

function target(planning: ChatWalkPlanningInput) {
  const result = planChatWalk(planning);
  expect(result.kind).toBe('planned');
  if (result.kind !== 'planned') throw new Error('Expected a plan');
  expect(validateActivityDefinition(result.definition)).toBe(true);
  expect(result.definition).toMatchObject({ id: 'chat_walk', priority: 'P1_user_interaction' });
  expect(result.definition.steps).toHaveLength(1);
  const step = result.definition.steps[0]!;
  if (step.type !== 'locomotion') throw new Error('Expected locomotion');
  expect(step).toMatchObject({ gait: 'walk', timeoutMs: 7000 });
  expect(step.traversal).toBeUndefined();
  return step.targetRootPosition;
}

describe('chat walk planning', () => {
  it('walks at most 160 DIP in screen coordinates and preserves support Y', () => {
    expect(target(input())).toEqual({ x: 340, y: 790 });
    expect(target(input({ direction: 'right' }))).toEqual({ x: 660, y: 790 });
    expect(target(input({ root: { x: 100, y: 790 } }))).toEqual({ x: 50, y: 790 });
    expect(target(input({ root: { x: 940, y: 790 }, direction: 'right' }))).toEqual({ x: 950, y: 790 });
  });

  it('preserves a grounded root after native window pixel quantization', () => {
    expect(target(input({ root: { x: 500, y: 789.625 } }))).toEqual({ x: 340, y: 789.625 });
    expect(target(input({ root: { x: 500, y: 789.5 } }))).toEqual({ x: 340, y: 789.5 });
    expect(planChatWalk(input({ root: { x: 500, y: 789.499 } }))).toMatchObject({ kind: 'rejected' });
    expect(planChatWalk(input({ root: { x: 500, y: 790.1 } }))).toMatchObject({ kind: 'rejected' });
  });

  it('refuses a zero-distance edge instead of reversing direction', () => {
    expect(planChatWalk(input({ root: { x: 50, y: 790 } }))).toEqual({ kind: 'rejected', reason: 'edge' });
    expect(planChatWalk(input({ root: { x: 950, y: 790 }, direction: 'right' }))).toEqual({ kind: 'rejected', reason: 'edge' });
  });

  it('intersects a fresh window top with screen collision limits', () => {
    const base = input();
    const environment = { ...base.environment, currentSurface: {
      id: 'window', kind: 'window_top' as const, supportY: 400, isValidSupport: true,
      bounds: { x: 30, y: 400, width: 600, height: 200 },
    } };
    expect(target(input({ root: { x: 100, y: 400 }, environment }))).toEqual({ x: 50, y: 400 });
    expect(target(input({ root: { x: 500, y: 400 }, environment, direction: 'right' }))).toEqual({ x: 630, y: 400 });
    expect(planChatWalk(input({ root: { x: 500, y: 399.625 }, environment }))).toMatchObject({ kind: 'rejected' });
    expect(planChatWalk(input({ root: { x: 500, y: 400 }, environment, nowMs: 1301 })))
      .toEqual({ kind: 'rejected', reason: 'no_support' });
    expect(planChatWalk(input({ root: { x: 500, y: 400 }, environment, nowMs: 999 })))
      .toEqual({ kind: 'rejected', reason: 'no_support' });
  });

  it('does not snap invalid or unsupported roots to a floor', () => {
    const base = input();
    const cases: ChatWalkPlanningInput[] = [
      input({ root: { x: 49, y: 790 } }), input({ root: { x: 500, y: 789 } }),
      input({ root: { x: Number.NaN, y: 790 } }),
      input({ environment: { ...base.environment, currentSurface: undefined } }),
      input({ environment: { ...base.environment, currentSurface: { ...base.environment.currentSurface!, isValidSupport: false } } }),
      input({ environment: { ...base.environment, currentSurface: { ...base.environment.currentSurface!, kind: 'window_side' } } }),
      input({ collisionInsets: { left: 600, right: 600, top: 90, bottom: 10 } }),
      input({ environment: { ...base.environment, currentSurface: { ...base.environment.currentSurface!, bounds: { x: 0, y: 0, width: -1, height: 800 } } } }),
    ];
    for (const planning of cases) expect(planChatWalk(planning)).toEqual({ kind: 'rejected', reason: 'no_support' });
  });
});
