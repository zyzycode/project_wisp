/**
 * Domain Model: Behavior Intent
 * Canonical definitions for character behavior intentions as specified in
 * docs/engine/BEHAVIOR_INTENTS.md.
 * Pure domain definitions without UI/DOM/React/CSS or provider SDK details.
 */

export type BehaviorIntentKind =
  | 'respond'
  | 'think'
  | 'react_happy'
  | 'react_confused'
  | 'play'
  | 'sleep'
  | 'wake'
  | 'drag'
  | 'land'
  | 'wander'
  | 'idle'
  | 'quiet';

export type BehaviorIntentSource = 'user' | 'provider' | 'timer' | 'memory' | 'system';

export type BehaviorIntentPriority = 'low' | 'normal' | 'high' | 'critical';

export type BehaviorIntentMoodHint =
  | 'neutral'
  | 'happy'
  | 'curious'
  | 'sleepy'
  | 'confused'
  | 'shy'
  | 'affectionate';

export interface BehaviorIntent {
  kind: BehaviorIntentKind;
  source: BehaviorIntentSource;
  priority: BehaviorIntentPriority;
  replyText?: string;
  moodHint?: BehaviorIntentMoodHint;
  reason?: string;
  requestId?: string;
}
