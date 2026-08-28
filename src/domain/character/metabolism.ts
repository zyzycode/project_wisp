import type { Needs, SynthesizedEmotionalTone } from './types';

const MS_PER_HOUR = 60 * 60 * 1000;

interface NeedDrift {
  readonly target: Needs;
  readonly ratePerHour: Needs;
}

const DEFAULT_DRIFT: NeedDrift = {
  target: {
    energy: 74,
    attention: 56,
    play: 60,
    comfort: 18,
  },
  ratePerHour: {
    energy: 0.2,
    attention: 0.08,
    play: 0.1,
    comfort: 0.22,
  },
};

const TONE_DRIFTS: Record<SynthesizedEmotionalTone, NeedDrift> = {
  neutral: DEFAULT_DRIFT,
  curious: {
    target: { energy: 70, attention: 52, play: 64, comfort: 20 },
    ratePerHour: { energy: 0.18, attention: 0.08, play: 0.12, comfort: 0.18 },
  },
  shy: {
    target: { energy: 68, attention: 48, play: 46, comfort: 26 },
    ratePerHour: { energy: 0.18, attention: 0.05, play: 0.06, comfort: 0.2 },
  },
  sleepy: {
    target: { energy: 82, attention: 44, play: 38, comfort: 12 },
    ratePerHour: { energy: 0.3, attention: 0.04, play: 0.05, comfort: 0.32 },
  },
  playful: {
    target: { energy: 58, attention: 50, play: 50, comfort: 24 },
    ratePerHour: { energy: 0.16, attention: 0.09, play: 0.08, comfort: 0.16 },
  },
  affectionate: {
    target: { energy: 66, attention: 38, play: 45, comfort: 16 },
    ratePerHour: { energy: 0.16, attention: 0.06, play: 0.07, comfort: 0.2 },
  },
  flustered: {
    target: { energy: 60, attention: 42, play: 42, comfort: 34 },
    ratePerHour: { energy: 0.14, attention: 0.05, play: 0.05, comfort: 0.18 },
  },
};

function clampNeed(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function approach(current: number, target: number, ratePerHour: number, hours: number): number {
  const factor = 1 - Math.exp(-ratePerHour * hours);
  return clampNeed(current + (target - current) * factor);
}

export function metabolizeNeeds(
  needs: Needs,
  deltaMs: number,
  tone: SynthesizedEmotionalTone = 'neutral'
): Needs {
  const hours = Math.max(0, deltaMs) / MS_PER_HOUR;

  if (hours === 0) {
    return {
      energy: clampNeed(needs.energy),
      attention: clampNeed(needs.attention),
      play: clampNeed(needs.play),
      comfort: clampNeed(needs.comfort),
    };
  }

  const drift = TONE_DRIFTS[tone];

  return {
    energy: approach(needs.energy, drift.target.energy, drift.ratePerHour.energy, hours),
    attention: approach(needs.attention, drift.target.attention, drift.ratePerHour.attention, hours),
    play: approach(needs.play, drift.target.play, drift.ratePerHour.play, hours),
    comfort: approach(needs.comfort, drift.target.comfort, drift.ratePerHour.comfort, hours),
  };
}
