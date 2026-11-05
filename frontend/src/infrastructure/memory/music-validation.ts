import type { MusicDiscussionSample, MusicDialogueSource, MusicInterestEvidence, MusicTopicId, MusicUserPreference } from '../../application/ports/music-interest.interface';
import { MUSIC_TOPICS } from '../../domain/character/music-interest';
import { MemoryDataError, record, text, timestamp } from './validation-primitives';
export function musicTopic(value: unknown): MusicTopicId {
  if (typeof value !== 'string' || !MUSIC_TOPICS.some(topic => topic === value)) throw new MemoryDataError('invalid_data');
  return value as MusicTopicId;
}
export function musicSource(value: unknown): MusicDialogueSource {
  const s = record(value, ['conversationSessionId','userMessageId','assistantMessageId','revision']);
  if (s.revision !== 1 || s.userMessageId === s.assistantMessageId) throw new MemoryDataError('invalid_data');
  return { conversationSessionId: text(s.conversationSessionId), userMessageId: text(s.userMessageId), assistantMessageId: text(s.assistantMessageId), revision: 1 };
}
export function musicSample(value: unknown): MusicDiscussionSample {
  const s = record(value, ['topic','intention','opening','continuation','occurredAt']);
  if (s.intention !== 'ask_music_detail') throw new MemoryDataError('invalid_data');
  const opening = musicSource(s.opening), continuation = musicSource(s.continuation);
  if (opening.conversationSessionId !== continuation.conversationSessionId
    || new Set([opening.userMessageId, opening.assistantMessageId, continuation.userMessageId, continuation.assistantMessageId]).size !== 4) throw new MemoryDataError('invalid_data');
  return { topic: musicTopic(s.topic), intention: 'ask_music_detail', opening, continuation, occurredAt: timestamp(s.occurredAt) };
}
export function musicPreference(value: unknown): MusicUserPreference {
  const s = record(value, ['topic','disposition','source','occurredAt']);
  if (s.disposition !== 'like' && s.disposition !== 'dislike') throw new MemoryDataError('invalid_data');
  return { topic: musicTopic(s.topic), disposition: s.disposition, source: musicSource(s.source), occurredAt: timestamp(s.occurredAt) };
}
export function musicEvidence(value: unknown): MusicInterestEvidence {
  const r = record(value, ['samples','userPreferences']);
  if (!Array.isArray(r.samples) || r.samples.length > 48 || !Array.isArray(r.userPreferences) || r.userPreferences.length > 4) throw new MemoryDataError('invalid_data');
  const samples = r.samples.map(musicSample), userPreferences = r.userPreferences.map(musicPreference);
  if (new Set(samples.map(s => `${s.topic}:${s.occurredAt.slice(0,10)}`)).size !== samples.length || new Set(samples.flatMap(s => [s.opening.userMessageId,s.continuation.userMessageId])).size !== samples.length * 2 || new Set(userPreferences.map(p => p.topic)).size !== userPreferences.length || MUSIC_TOPICS.some(t => samples.filter(s => s.topic === t).length > 12)) throw new MemoryDataError('invalid_data');
  return { samples, userPreferences };
}
