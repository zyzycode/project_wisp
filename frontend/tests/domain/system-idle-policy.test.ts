import { describe, expect, it } from 'vitest';
import {
  createSystemIdleState,
  systemPresenceAt,
  updateSystemIdle,
  type SystemIdleState,
} from '../../src/domain/behavior/system-idle-policy';

type Sample = Parameters<typeof updateSystemIdle>[1];

function session(initialState = createSystemIdleState(1)) {
  let state = initialState;
  let sequence = 0;
  let nowMs = 0;
  return {
    get state() { return state; },
    get nowMs() { return nowMs; },
    sample(idleMs: number | null, overrides: Partial<Sample> = {}) {
      const input = {
        generation: 1, sequence: sequence++, nowMs, wallNowMs: 100_000 + nowMs,
        idleMs, armingAllowed: true, ...overrides,
      };
      const result = updateSystemIdle(state, input);
      state = result.state;
      nowMs = input.nowMs + 1_000;
      return result;
    },
  };
}

function observedAway(armingAllowed = true) {
  const run = session();
  for (let idleMs = 1_000; idleMs <= 301_000; idleMs += 1_000) {
    expect(run.sample(idleMs, { armingAllowed }).returned).toBe(false);
  }
  expect(run.state.presence).toBe('probably_away');
  return run;
}

describe('Domain: system idle presence', () => {
  it('starts unknown and has no projection without a positive sample', () => {
    const state = createSystemIdleState(1);
    expect(state.presence).toBe('unknown');
    expect(systemPresenceAt(state, 0)).toBe('unknown');
  });

  it.each([
    [1_000, 'active'], [30_000, 'active'], [31_000, 'inactive'],
    [59_000, 'inactive'], [60_000, 'inactive'], [300_000, 'inactive'],
  ] as const)('classifies first positive %i as %s without inventing history', (idle, presence) => {
    expect(session().sample(idle)).toMatchObject({ state: { presence }, returned: false });
  });

  it('enters inactive at 60000 and reenters active at 30000', () => {
    const run = session();
    for (let idle = 30_000; idle < 60_000; idle += 1_000) {
      expect(run.sample(idle).state.presence).toBe('active');
    }
    expect(run.sample(60_000).state.presence).toBe('inactive');
    expect(run.sample(31_000).state.presence).toBe('inactive');
    expect(run.sample(30_000).state.presence).toBe('active');
  });

  it.each([1_000, 2_500])('confirms high idle only after a second sample %i ms later', gap => {
    const run = session();
    expect(run.sample(300_000).state.presence).toBe('inactive');
    expect(run.sample(301_000, { nowMs: gap, wallNowMs: 100_000 + gap }))
      .toMatchObject({ state: { presence: 'probably_away' }, returned: false });
    expect(run.sample(1_000).returned).toBe(false);
  });

  it('requires consecutive high samples separated by at least 1000 ms', () => {
    const run = session();
    run.sample(300_000);
    expect(run.sample(300_000, { nowMs: 999, wallNowMs: 100_999 }).state.presence).toBe('inactive');
    expect(run.sample(301_000, { nowMs: 1_000, wallNowMs: 101_000 }).state.presence).toBe('inactive');
    expect(run.sample(302_000, { nowMs: 2_000, wallNowMs: 102_000 }).state.presence).toBe('probably_away');
  });

  it('a high pair separated by 2501 ms instead starts an unconfirmed recovery baseline', () => {
    const run = session();
    run.sample(300_000);
    expect(run.sample(301_000, { nowMs: 2_501, wallNowMs: 102_501 }).state.presence).toBe('unknown');
    expect(run.sample(302_000).state.presence).toBe('inactive');
    expect(run.sample(303_000).state.presence).toBe('probably_away');
    expect(run.sample(1_000).returned).toBe(false);
  });

  it('breaks high confirmation on an intervening low positive', () => {
    const run = session();
    run.sample(300_000);
    run.sample(299_000);
    expect(run.sample(300_000).state.presence).toBe('inactive');
    expect(run.sample(301_000).state.presence).toBe('probably_away');
  });

  it.each([
    [240_000, 'probably_away'], [239_000, 'inactive'],
    [31_000, 'inactive'], [30_000, 'active'],
  ] as const)('applies away exit hysteresis at %i', (idle, presence) => {
    expect(observedAway().sample(idle)).toMatchObject({ state: { presence }, returned: false });
  });

  it.each([1_000, 5_000])('emits one return for a direct fresh positive of %i ms', idle => {
    const run = observedAway();
    expect(run.sample(idle)).toMatchObject({ state: { presence: 'active' }, returned: true });
    expect(run.sample(idle).returned).toBe(false);
    expect(run.sample(idle).returned).toBe(false);
  });

  it('allows return exactly at the last positive baseline TTL boundary', () => {
    const run = observedAway();
    expect(run.sample(1_000, { nowMs: 302_500, wallNowMs: 402_500 }).returned).toBe(true);
  });

  it.each([6_000, 30_000, 31_000, 239_000])('consumes return on any other away exit (%i)', idle => {
    const run = observedAway();
    expect(run.sample(idle).returned).toBe(false);
    expect(run.sample(1_000).returned).toBe(false);
  });

  it('permits another return only after a new continuous active-to-away episode', () => {
    const run = observedAway();
    expect(run.sample(1_000).returned).toBe(true);
    for (let idle = 2_000; idle <= 301_000; idle += 1_000) run.sample(idle);
    expect(run.sample(1_000).returned).toBe(true);
  });

  it('an inactive exit loses old active history before reconfirming away', () => {
    const run = observedAway();
    for (let idle = 239_000; idle <= 301_000; idle += 1_000) run.sample(idle);
    expect(run.state.presence).toBe('probably_away');
    expect(run.sample(1_000).returned).toBe(false);
  });

  it.each([NaN, Infinity, -Infinity, -1, 0, 1, 999, 1_001, 1_000.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid raw idle %s and loses continuity', invalid => {
      const run = observedAway();
      expect(run.sample(invalid)).toMatchObject({ state: { presence: 'unknown' }, returned: false });
      expect(run.sample(1_000).returned).toBe(false);
    },
  );

  it('read failure breaks continuity even while its last positive was fresh', () => {
    const run = observedAway();
    expect(run.sample(null).state.presence).toBe('unknown');
    expect(run.sample(1_000).returned).toBe(false);
  });

  it('projects ambiguous zero as unknown but preserves a fresh private return baseline', () => {
    const run = observedAway();
    expect(run.sample(null, { unconfirmed: true }).state.presence).toBe('unknown');
    expect(systemPresenceAt(run.state, run.nowMs)).toBe('unknown');
    expect(run.sample(1_000)).toMatchObject({ state: { presence: 'active' }, returned: true });
  });

  it('ambiguous zero interrupts high confirmation', () => {
    const run = session();
    run.sample(300_000);
    run.sample(null, { unconfirmed: true });
    expect(run.sample(302_000).state.presence).toBe('inactive');
    expect(run.sample(303_000).state.presence).toBe('probably_away');
  });

  it('a positive after a fresh ambiguous zero uses the private state hysteresis', () => {
    const run = session();
    for (let idle = 30_000; idle <= 57_000; idle += 1_000) run.sample(idle);
    run.sample(null, { unconfirmed: true });
    expect(run.sample(59_000).state.presence).toBe('active');
    expect(run.sample(60_000).state.presence).toBe('inactive');
  });

  it('repeated zero never refreshes the positive baseline TTL', () => {
    const run = observedAway();
    run.sample(null, { unconfirmed: true });
    run.sample(null, { unconfirmed: true });
    expect(run.sample(null, { unconfirmed: true }).state.presence).toBe('unknown');
    expect(run.sample(1_000).returned).toBe(false);
  });

  it.each([
    [0, 'probably_away'], [2_500, 'probably_away'], [2_501, 'unknown'],
    [-1, 'unknown'], [NaN, 'unknown'], [Infinity, 'unknown'],
  ] as const)('projects positive baseline age %s as %s', (age, presence) => {
    const run = observedAway();
    expect(systemPresenceAt(run.state, run.nowMs - 1_000 + age)).toBe(presence);
  });

  it('ignores repeated or older sequence without refreshing TTL or consuming return', () => {
    const run = observedAway();
    const state = run.state;
    for (const sequence of [300, 299, -1, NaN, 301.5]) {
      expect(run.sample(1_000, { sequence, nowMs: 301_000, wallNowMs: 401_000 }))
        .toEqual({ state, returned: false });
    }
    expect(systemPresenceAt(run.state, 302_501)).toBe('unknown');
    expect(run.sample(1_000, { sequence: 301, nowMs: 302_000, wallNowMs: 402_000 }).returned).toBe(true);
  });

  it('ignores callbacks from another generation without changing state', () => {
    const run = observedAway();
    const state = run.state;
    expect(run.sample(1_000, { generation: 0 })).toEqual({ state, returned: false });
    expect(run.sample(1_000, { generation: 2 })).toEqual({ state, returned: false });
  });

  it('lifecycle replacement never revives the old return latch', () => {
    const old = observedAway().state;
    const state = createSystemIdleState(2);
    expect(updateSystemIdle(state, {
      generation: 1, sequence: 301, nowMs: 301_000, wallNowMs: 401_000,
      idleMs: 1_000, armingAllowed: true,
    })).toEqual({ state, returned: false });
    expect(session(state).sample(1_000, { generation: 2 }).returned).toBe(false);
    expect(old.presence).toBe('probably_away');
  });

  it.each([
    { nowMs: 302_501, wallNowMs: 402_501 },
    { nowMs: 299_999, wallNowMs: 399_999 },
    { nowMs: 301_000, wallNowMs: 399_999 },
    { nowMs: 301_000, wallNowMs: 402_001 },
    { nowMs: 302_000, wallNowMs: 400_999 },
    { nowMs: NaN, wallNowMs: 401_000 },
    { nowMs: 301_000, wallNowMs: Infinity },
  ])('invalidates discontinuous time %j without returning', clocks => {
    const run = observedAway();
    expect(run.sample(1_000, clocks)).toMatchObject({ state: { presence: 'unknown' }, returned: false });
  });

  it.each([1_000, -1_000])('permits wall/monotonic delta divergence exactly %i', divergence => {
    const run = observedAway();
    expect(run.sample(1_000, { wallNowMs: 401_000 + divergence }).returned).toBe(true);
  });

  it('invalidates excessive idle growth but accepts exactly elapsed plus 1000 ms', () => {
    const valid = session();
    valid.sample(1_000);
    expect(valid.sample(3_000).state.presence).toBe('active');
    const invalid = session();
    invalid.sample(1_000);
    expect(invalid.sample(4_000)).toMatchObject({ state: { presence: 'unknown' }, returned: false });
    expect(invalid.sample(5_000).state.presence).toBe('active');
  });

  it('a discontinuity baseline neither confirms high idle nor arms history', () => {
    const run = observedAway();
    expect(run.sample(500_000).state.presence).toBe('unknown');
    expect(run.sample(501_000).state.presence).toBe('inactive');
    expect(run.sample(502_000).state.presence).toBe('probably_away');
    expect(run.sample(1_000).returned).toBe(false);
  });

  it('unknown after a gap cannot fabricate return from the old away baseline', () => {
    const run = observedAway();
    run.sample(1_000, { nowMs: 303_000, wallNowMs: 403_000 });
    expect(run.sample(2_000)).toMatchObject({ state: { presence: 'active' }, returned: false });
  });

  it('quiet/menu disarms both latch and active history until a new active-to-away episode', () => {
    const run = observedAway();
    expect(run.sample(302_000, { armingAllowed: false }).state.presence).toBe('probably_away');
    expect(run.sample(1_000).returned).toBe(false);
    for (let idle = 2_000; idle <= 301_000; idle += 1_000) run.sample(idle);
    expect(run.sample(1_000).returned).toBe(true);
  });

  it('observing active and away entirely with arming disabled never arms return', () => {
    expect(observedAway(false).sample(1_000).returned).toBe(false);
  });

  it('closing arming during inactive clears earlier active history', () => {
    const run = session();
    for (let idle = 30_000; idle <= 301_000; idle += 1_000) {
      run.sample(idle, { armingAllowed: idle !== 60_000 });
    }
    expect(run.state.presence).toBe('probably_away');
    expect(run.sample(1_000).returned).toBe(false);
  });

  it('disarms even when quiet/menu sample is an ambiguous zero', () => {
    const run = observedAway();
    run.sample(null, { unconfirmed: true, armingAllowed: false });
    expect(run.sample(1_000).returned).toBe(false);
  });

  it('does not mutate a retained input state', () => {
    const run = observedAway();
    const previous: SystemIdleState = run.state;
    const copy = structuredClone(previous);
    run.sample(1_000);
    expect(previous).toEqual(copy);
  });
});
