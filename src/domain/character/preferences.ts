import type { PreferenceTrack } from './types';

const MAX_ABS_PREFERENCE_VALUE = 100;
const CONFIDENCE_SAMPLE_HALF_LIFE = 6;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function calculateConfidence(samples: number): number {
  return clamp(samples / (samples + CONFIDENCE_SAMPLE_HALF_LIFE), 0, 1);
}

export function trackPreference(
  preferences: Record<string, PreferenceTrack>,
  key: string,
  value: number,
  weight = 1
): Record<string, PreferenceTrack> {
  const safeWeight = Math.max(0, weight);
  const previous = preferences[key] ?? {
    value: 0,
    confidence: 0,
    samples: 0,
  };
  const nextSamples = previous.samples + 1;
  const valueWeight = previous.samples + safeWeight;
  const sampleValue = clamp(value, -MAX_ABS_PREFERENCE_VALUE, MAX_ABS_PREFERENCE_VALUE);
  const nextValue =
    valueWeight === 0
      ? previous.value
      : (previous.value * previous.samples + sampleValue * safeWeight) / valueWeight;

  return {
    ...preferences,
    [key]: {
      value: clamp(nextValue, -MAX_ABS_PREFERENCE_VALUE, MAX_ABS_PREFERENCE_VALUE),
      confidence: calculateConfidence(nextSamples),
      samples: nextSamples,
    },
  };
}
