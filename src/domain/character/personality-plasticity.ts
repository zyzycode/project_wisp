import type { AxisValue, PersonalityAxis } from './types';

export type PersonalityAxisDeltas = Partial<Record<PersonalityAxis, number>>;

const PERSONALITY_AXES: readonly PersonalityAxis[] = [
  'openness',
  'extraversion',
  'agreeableness',
  'sensitivity',
  'playfulness',
  'boldness',
  'independence',
];

const SOFT_BOUNDARY_RESISTANCE = 0.35;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function applySoftBoundaryResistance(axis: AxisValue, scaledDelta: number): number {
  const projected = axis.current + scaledDelta;

  if (projected < axis.softMin) {
    if (axis.current >= axis.softMin) {
      return axis.softMin + (projected - axis.softMin) * SOFT_BOUNDARY_RESISTANCE;
    }

    return axis.current + scaledDelta * SOFT_BOUNDARY_RESISTANCE;
  }

  if (projected > axis.softMax) {
    if (axis.current <= axis.softMax) {
      return axis.softMax + (projected - axis.softMax) * SOFT_BOUNDARY_RESISTANCE;
    }

    return axis.current + scaledDelta * SOFT_BOUNDARY_RESISTANCE;
  }

  return projected;
}

export function adaptPersonalityAxes(
  axes: Record<PersonalityAxis, AxisValue>,
  deltas: PersonalityAxisDeltas,
  weight = 1
): Record<PersonalityAxis, AxisValue> {
  const safeWeight = Math.max(0, weight);

  return PERSONALITY_AXES.reduce<Record<PersonalityAxis, AxisValue>>((nextAxes, axisName) => {
    const axis = axes[axisName];
    const requestedDelta = deltas[axisName] ?? 0;
    const scaledDelta = requestedDelta * axis.plasticity * safeWeight;
    const resisted = applySoftBoundaryResistance(axis, scaledDelta);

    nextAxes[axisName] = {
      ...axis,
      current: clamp(resisted, axis.hardMin, axis.hardMax),
    };

    return nextAxes;
  }, {} as Record<PersonalityAxis, AxisValue>);
}
