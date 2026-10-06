import { takeAdaptationOpportunity, type AdaptationGate } from './adaptation-gate';
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

/** A verified persisted assertion provides a small sample, never a direct preference assignment. */
export function learnCursorGamePreference(preferences: Readonly<Record<string, PreferenceTrack>>, disposition: 'like' | 'dislike'): Record<string, PreferenceTrack> {
  const old = preferences['activity.cursor_game'] ?? { value: 0, confidence: 0, samples: 0 };
  const target = disposition === 'like' ? 100 : -100;
  const samples = Math.min(old.samples + 1, 1000);
  return { ...preferences, 'activity.cursor_game': {
    value: clamp(old.value + clamp((target - old.value) * 0.05, -2, 2), -100, 100),
    samples, confidence: samples / (samples + 6),
  } };
}

export function learnVerifiedCursorPreference(preferences: Record<string, PreferenceTrack>, disposition: 'like' | 'dislike', gate: AdaptationGate, nowMs: number): { readonly preferences: Record<string, PreferenceTrack>; readonly gate: AdaptationGate } {
  const opportunity = takeAdaptationOpportunity(gate, nowMs, disposition === 'like' || disposition === 'dislike');
  return { preferences: opportunity.accepted ? learnCursorGamePreference(preferences, disposition) : preferences, gate: opportunity.gate };
}
