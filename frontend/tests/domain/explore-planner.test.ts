import { describe, expect, it } from 'vitest';
import {
  createExploreActivityDefinition,
  createExplorePlanCandidates,
  recordExplorePlan,
  scoreExplorePlans,
  selectExplorePlan,
  type ExplorePlanningContext,
} from '../../src/domain/behavior';

function context(
  overrides: Partial<ExplorePlanningContext> = {}
): ExplorePlanningContext {
  return {
    currentRootPosition: { x: 500, y: 790 },
    environment: {
      capturedAtMs: 0,
      screenBounds: { id: 'primary', x: 0, y: 0, width: 1_000, height: 800 },
      currentSurface: {
        id: 'floor', kind: 'screen_floor', bounds: { x: 0, y: 0, width: 1_000, height: 800 },
        supportY: 800, isValidSupport: true,
      },
    },
    collisionInsets: { left: 50, right: 50, top: 90, bottom: 10 },
    needs: { energy: 80, attention: 20, play: 20, comfort: 20, boredom: 20 },
    tone: 'neutral',
    history: { entries: [] },
    nowMs: 0,
    ...overrides,
  };
}

describe('Domain: Explore planner', () => {
  it('holds a completed resting entrance until its semantic phase ends', () => {
    const plan = createExplorePlanCandidates(context({ needs: { energy: 20, attention: 20, play: 20, comfort: 80 } }))
      .find(candidate => candidate.pose === 'lie')!;
    expect(createExploreActivityDefinition(plan).steps.find(step => step.id === 'pose')).toMatchObject({ intent: { loop: 'none' } });
  });
  it('filters unreachable points and keeps sufficiently distant targets on valid support', () => {
    const plans = createExplorePlanCandidates(context());

    expect(plans.length).toBeGreaterThan(3);
    expect(plans.every((plan) => plan.distancePx >= 96 && plan.distancePx <= 500)).toBe(true);
    expect(plans.every((plan) => plan.targetRootPosition.y === 790)).toBe(true);
    expect(new Set(plans.map((plan) => plan.pointKind))).toEqual(
      new Set(['ordinary', 'corner', 'edge', 'interesting_surface'])
    );

    const unavailable = context({
      environment: {
        ...context().environment,
        currentSurface: { ...context().environment.currentSurface!, isValidSupport: false },
      },
    });
    expect(createExplorePlanCandidates(unavailable)).toEqual([]);
  });

  it('penalizes recent targets, routes, and choreography while strong need overcomes the penalty', () => {
    const base = context();
    const plan = createExplorePlanCandidates(base)[0]!;
    const history = {
      entries: Array.from({ length: 4 }, () => ({
        targetId: plan.targetId,
        routeKey: plan.routeKey,
        choreographyKey: plan.choreographyKey,
        selectedAtMs: 0,
      })),
    };
    const repeated = scoreExplorePlans([plan], { ...base, history }, undefined)[0]!;
    const fresh = scoreExplorePlans([plan], base, undefined)[0]!;
    const strongNeed = scoreExplorePlans([plan], {
      ...base,
      history,
      needs: { energy: 100, attention: 100, play: 100, comfort: 0, boredom: 100 },
    }, undefined)[0]!;

    expect(repeated.repetitionScore).toBeLessThan(fresh.repetitionScore);
    expect(strongNeed.repetitionScore).toBeGreaterThan(repeated.repetitionScore);
    expect(strongNeed.repetitionScore).toBeCloseTo(1, 8);
  });

  it('selects deterministically, records bounded history, and builds one point-specific chain', () => {
    const planning = context();
    const plan = selectExplorePlan(planning, 0.4)!;
    const repeat = selectExplorePlan(planning, 0.4)!;
    expect(repeat).toEqual(plan);

    let history = { entries: [] as const };
    for (let index = 0; index < 20; index += 1) {
      history = recordExplorePlan(history, plan, index) as typeof history;
    }
    expect(history.entries).toHaveLength(12);

    const definition = createExploreActivityDefinition(plan);
    expect(definition.id).toBe('explore');
    expect(definition.steps[0]).toMatchObject({
      type: 'locomotion', targetRef: plan.targetId,
    });
    expect(definition.steps[1]).toMatchObject({
      type: 'animation', intent: { kind: plan.inspection },
    });
    expect(definition.steps.filter((step) => step.type === 'locomotion')).toHaveLength(1);
  });
});
