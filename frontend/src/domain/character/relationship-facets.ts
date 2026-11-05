import type { CausalObservedEvent } from './causal-affect';
import type { Relationship, RelationshipFacets, RelationshipProjection } from './types';

export const RELATIONSHIP_FACET_KEYS = ['familiarity', 'trust', 'affection', 'respect', 'resentment', 'comfort'] as const;

/** One-way legacy conversion; historical friendship does not prove trust. */
export function createRelationship(legacy: RelationshipProjection): Relationship {
  return { ...legacy, familiarity: legacy.friendship, affection: legacy.friendship,
    trust: 500, respect: 500, comfort: 500, resentment: 0 };
}

export function projectRelationship(relationship: Relationship): RelationshipProjection {
  return { friendship: relationship.familiarity, love: relationship.love, loveUnlocked: relationship.loveUnlocked };
}

export function shiftRelationshipFacets(relationship: Relationship, deltas: Partial<RelationshipFacets>): Relationship {
  const next = { ...relationship };
  for (const key of RELATIONSHIP_FACET_KEYS) next[key] = Math.min(1000, Math.max(0, relationship[key] + (deltas[key] ?? 0)));
  next.friendship = next.familiarity;
  return next;
}

/** Returns no proposal for unrelated/first interruption; the Application owns the shared time gate. */
export function causalRelationshipDeltas(event: CausalObservedEvent, repeatedInterruption: boolean): Partial<RelationshipFacets> | null {
  if (event.activity !== 'cursor_game' || !event.activityRunId) return null;
  if (event.cause === 'completed' && event.outcome === 'completed' && event.participation === 'user_engaged') {
    return { affection: 1, trust: 1, comfort: 1 };
  }
  if (event.cause === 'user_interrupted' && event.outcome === 'cancelled' && event.source === 'user'
      && event.triggerSequence !== null && event.executedMs >= 1000 && repeatedInterruption) return { resentment: 1, comfort: -1 };
  return null;
}
