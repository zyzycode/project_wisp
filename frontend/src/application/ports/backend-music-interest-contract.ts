import type { MusicTopicId } from './music-interest.interface';

/** Ordinary chat only; source validation remains local to Application. */
export interface BackendMusicTopicContext {
  readonly scope: 'text_discussion';
  readonly topic: MusicTopicId;
  readonly characterInterest: 'unknown' | 'emerging' | 'established';
  readonly userPreference?: {
    readonly topic: MusicTopicId;
    readonly disposition: 'like' | 'dislike';
  };
  readonly intention?: 'ask_music_detail';
}
