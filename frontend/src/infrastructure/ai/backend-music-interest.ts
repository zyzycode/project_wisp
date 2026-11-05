import type { BackendMusicTopicContext } from '../../application/ports/backend-music-interest-contract';
import { exactRecord, enumValue } from '../../shared/dialogue-ipc-validation';
export function parseMusicTopic(value: unknown): BackendMusicTopicContext {
  const r = exactRecord(value, ['scope','topic','characterInterest'], ['userPreference','intention']);
  if (r.scope !== 'text_discussion') throw new TypeError('Invalid music scope');
  const topic = enumValue(r.topic,['jazz','classical','rock','electronic']);
  const characterInterest = enumValue(r.characterInterest,['unknown','emerging','established']);
  let userPreference: BackendMusicTopicContext['userPreference'];
  if (Object.hasOwn(r,'userPreference')) {
    const p = exactRecord(r.userPreference,['topic','disposition']);
    userPreference = { topic: enumValue(p.topic,['jazz','classical','rock','electronic']), disposition: enumValue(p.disposition,['like','dislike']) };
  }
  if (Object.hasOwn(r,'intention') && r.intention !== 'ask_music_detail') throw new TypeError('Invalid music intention');
  if (characterInterest === 'unknown' && !userPreference && r.intention === undefined) throw new TypeError('Empty music context');
  const result: BackendMusicTopicContext = { scope: 'text_discussion', topic, characterInterest,
    ...(userPreference ? { userPreference } : {}), ...(r.intention === 'ask_music_detail' ? { intention: r.intention } : {}) };
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 512) throw new TypeError('Music context size');
  return result;
}
