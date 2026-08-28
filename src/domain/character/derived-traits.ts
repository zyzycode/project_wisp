import type { AxisValue, PersonalityAxis } from './types';

export function calculateShyness(axes: Record<PersonalityAxis, AxisValue>): number {
  return (
    axes.sensitivity.current * 0.45 +
    (1 - axes.boldness.current) * 0.35 +
    (1 - axes.extraversion.current) * 0.2
  );
}
