interface ForegroundContext {
  readonly foreground: 'settling' | 'stable' | 'unknown';
  readonly sampledAtMs: number;
}
/** Settling can postpone an invite; stable/unknown never grant permission. */
export function allowsDeferredInvitationContext(context: ForegroundContext | undefined, nowMs: number): boolean {
  if (!context || !Number.isFinite(nowMs) || nowMs < 0 || !Number.isFinite(context.sampledAtMs) || context.sampledAtMs < 0) return true;
  const age = nowMs - context.sampledAtMs;
  return context.foreground !== 'settling' || age < 0 || age > 2500;
}
