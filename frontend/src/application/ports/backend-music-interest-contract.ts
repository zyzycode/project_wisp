import type { MusicTopicId } from './music-interest.interface';

/** Target #179, ordinary chat only; not imported into active requests by #178. */
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
