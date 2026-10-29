import { describe, expect, it, vi } from 'vitest';
import { SocialBidFollowupPolicy } from '../../src/domain/behavior/social-bid-followup-policy';
import { createSocialBidActivity } from '../../src/domain/behavior/social-bid-activity';
function unanswered() { const p = new SocialBidFollowupPolicy(); p.firstStarted('first'); p.terminal('first', 'completed', 1000); return p; }
describe('SOC-A01 bounded second attempt', () => {
  it('requires actual first start and exactly one completed unanswered terminal', () => {
    const p = new SocialBidFollowupPolicy(), draw = vi.fn(() => 0);
    p.terminal('first', 'completed', 1000); expect(p.evaluate(31000, true, true, draw)).toBeNull();
    p.firstStarted('first'); expect(p.canStartFirst()).toBe(false);
    p.terminal('other', 'completed', 1000); expect(p.evaluate(31000, true, true, draw)).toBeNull();
    p.terminal('first', 'completed', 1000); p.terminal('first', 'completed', 9000);
    expect(p.evaluate(31000, true, true, draw)).not.toBeNull(); expect(draw).toHaveBeenCalledOnce();
    expect(p.evaluate(32000, true, true, draw)).toBeNull(); p.terminal('first', 'completed', 32000);
    expect(p.evaluate(63000, true, true, draw)).toBeNull(); expect(draw).toHaveBeenCalledOnce();
  });
  it.each([29999, 30000, 59999, 60000])('uses exact half-open window at %d', elapsed => {
    const p = unanswered(), draw = vi.fn(() => 0);
    expect(p.evaluate(1000 + elapsed, true, true, draw) !== null).toBe(elapsed >= 30000 && elapsed < 60000);
    expect(draw).toHaveBeenCalledTimes(elapsed >= 30000 && elapsed < 60000 ? 1 : 0);
  });
  it.each([0, 1 / 3 - Number.EPSILON, 1 / 3, 0.9, -1, NaN, 1])('one explicit probability draw: %s', value => {
    const p = unanswered(), draw = vi.fn(() => value);
    expect(p.evaluate(31000, true, true, draw) !== null).toBe(value >= 0 && value < 1 / 3);
    expect(p.evaluate(32000, true, true, draw)).toBeNull(); expect(draw).toHaveBeenCalledOnce();
    expect(p.canStartFirst()).toBe(false);
  });
  it('busy opportunity loses second without draw, queue or third', () => {
    const p = unanswered(), draw = vi.fn(() => 0);
    p.evaluate(30999, true, false, draw); expect(draw).not.toHaveBeenCalled();
    p.evaluate(31000, true, false, draw); expect(p.evaluate(32000, true, true, draw)).toBeNull();
    expect(draw).not.toHaveBeenCalled(); expect(p.canStartFirst()).toBe(false);
  });
  it.each(['cancelled', 'failed'] as const)('does not arm from %s', status => {
    const p = new SocialBidFollowupPolicy(); p.firstStarted('first'); p.terminal('first', status, 1000);
    const draw = vi.fn(() => 0); expect(p.evaluate(31000, true, true, draw)).toBeNull(); expect(draw).not.toHaveBeenCalled();
    expect(p.canStartFirst()).toBe(false);
  });
  it('invalidates before window, preserves latch, rejects late terminals/tickets and clears only contact/reset', () => {
    const p = unanswered(), draw = vi.fn(() => 0);
    p.evaluate(2000, false, true, draw); p.terminal('first', 'completed', 3000);
    expect(p.evaluate(33000, true, true, draw)).toBeNull(); expect(p.canStartFirst()).toBe(false);
    p.contact(); expect(p.canStartFirst()).toBe(true); p.firstStarted('next'); p.terminal('next', 'completed', 4000);
    const ticket = p.evaluate(34000, true, true, draw)!; p.invalidate();
    expect(p.isCurrent(ticket, 34000)).toBe(false); p.secondStarted(ticket, 'late', 34000);
    expect(p.canStartFirst()).toBe(false); p.reset(); expect(p.canStartFirst()).toBe(true);
  });
  it('second start and duplicate terminal never reopen chain across long time/budget expiry', () => {
    const p = unanswered(); const ticket = p.evaluate(31000, true, true, () => 0)!;
    p.secondStarted(ticket, 'second', 31000); expect(p.isCurrent(ticket, 31000)).toBe(false);
    p.terminal('second', 'completed', 35000); p.terminal('first', 'completed', 40000);
    const draw = vi.fn(() => 0); expect(p.evaluate(200000, true, true, draw)).toBeNull();
    expect(draw).not.toHaveBeenCalled(); expect(p.canStartFirst()).toBe(false);
  });
  it('defines curious gesture, bounded wait and a quiet ending without wave or talking', () => {
    const definition = createSocialBidActivity(9000, 'P4_autonomous', 'second');
    expect(definition.entryStepId).toBe('gesture');
    expect(definition.steps).toMatchObject([
      { type: 'animation', intent: { kind: 'thinking_loop', expressionHint: 'curious', propHint: 'none' }, completion: { durationMs: 1200 } },
      { type: 'animation', intent: { kind: 'idle_blink' }, completion: { durationMs: 4000 }, next: 'disengage' },
      { type: 'animation', stage: 'exiting', intent: { kind: 'look_around' }, completion: { durationMs: 800 }, next: 'settle' },
      { type: 'animation', stage: 'exiting', intent: { kind: 'settle' }, completion: { durationMs: 600 } },
    ]);
  });
});

it('preserves the short P3/system return invitation without the local ending', () => {
  const definition = createSocialBidActivity(2400, 'P3_reactive');
  expect(definition.steps.map(step => step.id)).toEqual(['notice', 'gesture', 'wait']);
  expect(definition.steps.at(-1)).toMatchObject({ completion: { durationMs: 2400 } });
  expect(definition.steps.at(-1)?.next).toBeUndefined();
});
