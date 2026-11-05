/** Pure CE-A01 calendar policy; monotonic clocks are never persisted. */
export interface DeferredInvitationSource {
  readonly occurredAt: string;
  readonly activity: string | null;
  readonly outcome: 'completed' | 'cancelled' | 'failed' | null;
  readonly participation: 'user_engaged' | 'solitary' | 'none';
}
export const DEFERRED_INVITATION_DELAY_MS = 300_000;
export const DEFERRED_INVITATION_TTL_MS = 86_400_000;
export function invitationSourceEligible(source: DeferredInvitationSource, nowMs: number): boolean {
  const occurredAtMs = Date.parse(source.occurredAt);
  return Number.isFinite(nowMs) && Number.isFinite(occurredAtMs) && occurredAtMs <= nowMs
    && source.activity === 'cursor_game' && source.outcome === 'completed' && source.participation === 'user_engaged';
}
export function invitationWindow(createdAt: string): { readonly notBefore: string; readonly expiresAt: string } {
  const at = Date.parse(createdAt);
  return { notBefore: new Date(at + DEFERRED_INVITATION_DELAY_MS).toISOString(), expiresAt: new Date(at + DEFERRED_INVITATION_TTL_MS).toISOString() };
}
export function invitationTimeState(value: { readonly createdAt: string; readonly notBefore: string; readonly expiresAt: string }, nowMs: number, lastSeenWallMs: number): 'cancelled' | 'expired' | 'waiting' | 'ready' {
  if (!Number.isFinite(nowMs) || nowMs < Date.parse(value.createdAt) || nowMs < lastSeenWallMs) return 'cancelled';
  if (nowMs >= Date.parse(value.expiresAt)) return 'expired';
  return nowMs >= Date.parse(value.notBefore) ? 'ready' : 'waiting';
}
