/** Explicit transient state; never persisted or derived from wall-clock timestamps. */
export interface AdaptationGate { readonly nextEligibleAtMs: number }
export const CHARACTER_ADAPTATION_INTERVAL_MS = 300_000;
export function createAdaptationGate(nowMs: number): AdaptationGate {
  return { nextEligibleAtMs: Number.isFinite(nowMs) && nowMs >= 0 ? nowMs + CHARACTER_ADAPTATION_INTERVAL_MS : Number.POSITIVE_INFINITY };
}
export function takeAdaptationOpportunity(gate: AdaptationGate, nowMs: number, eligible: boolean): { readonly accepted: boolean; readonly gate: AdaptationGate } {
  if (!eligible || !Number.isFinite(nowMs) || nowMs < gate.nextEligibleAtMs) return { accepted: false, gate };
  return { accepted: true, gate: createAdaptationGate(nowMs) };
}
