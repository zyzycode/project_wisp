import { expect, it } from 'vitest';
import { CharacterStateService } from '../../../src/application/services/character-state.service';
import { MemoryKnowledge } from '../../../src/application/services/memory-knowledge';
import type { VerifiedPreferenceEvidence } from '../../../src/application/ports/memory-knowledge.interface';
import type { IUserFactsRepository } from '../../../src/application/ports/memory-repository.interface';

const keys = ['activity.cursor_game', 'activity.explore', 'activity.social_bid'] as const;
function fixture() {
  let time = 0;
  const service = new CharacterStateService({ now: () => 0, monotonicNow: () => time });
  const observe = (sourceMessageId: string, key: VerifiedPreferenceEvidence['key'], disposition: 'like' | 'dislike' = 'like') =>
    service.observe({ sourceMessageId, key, disposition });
  return { service, observe, setTime: (now: number) => { time = now; } };
}
it.each(keys)('learns %s gradually without any extra Needs/axes/relationship/consent effects', key => {
  const positive = fixture(), negative = fixture(), original = positive.service.getState();
  for (let sample = 1; sample <= 6; sample++) {
    positive.setTime(sample * 300000); negative.setTime(sample * 300000);
    positive.observe(`source-${sample}`, key); negative.observe(`source-${sample}`, key, 'dislike');
  }
  expect(positive.service.getState()).toEqual({ ...original, preferences: { [key]: { value: 12, samples: 6, confidence: .5 } } });
  expect(negative.service.getState()).toEqual({ ...original, preferences: { [key]: { value: -12, samples: 6, confidence: .5 } } });
  positive.setTime(2100000); positive.observe('correction', key, 'dislike');
  expect(positive.service.getState().preferences[key]).toEqual({ value: 10, samples: 7, confidence: 7 / 13 });
});
it('shares one gate and one source identity across every key, including sources skipped during cooldown', () => {
  const f = fixture();
  f.observe('early', 'activity.explore'); f.setTime(300000);
  f.observe('early', 'activity.social_bid'); expect(f.service.getState().preferences).toEqual({});
  f.observe('accepted', 'activity.cursor_game'); f.observe('during-cooldown', 'activity.explore');
  f.setTime(600000); f.observe('accepted', 'activity.social_bid'); f.observe('during-cooldown', 'activity.social_bid');
  expect(Object.keys(f.service.getState().preferences)).toEqual(['activity.cursor_game']);
  f.observe('next', 'activity.social_bid'); f.observe('other', 'activity.explore');
  expect(f.service.getState().preferences['activity.social_bid']?.samples).toBe(1);
  expect(f.service.getState().preferences['activity.explore']).toBeUndefined();
});
it.each(['Мне нравятся твои прогулки', 'Мне нравятся твои инициативы общения'])('does not replay retired %s sources after defensive cache eviction', async text => {
  const f = fixture(); f.setTime(300000); let id = 0;
  const facts: IUserFactsRepository = { upsert: async fact => ({ ok: true, value: fact }), removeByKey: async () => ({ ok: true, value: undefined }), list: async () => ({ ok: true, value: [] }) };
  const owner = new MemoryKnowledge({ facts, isCurrent: generation => generation === 0, createId: () => `fact-${++id}`, onFailure: () => {}, preferenceLearning: f.service });
  const turn = (source: string) => ({ memoryGeneration: 0, user: { id: source, text, createdAt: '2026-10-25T00:00:00.000Z' },
    assistant: { id: `reply-${source}`, text: 'Хорошо', createdAt: '2026-10-25T00:00:00.000Z' } });
  for (let source = 0; source <= 100; source++) await owner.persisted(turn(`source-${source}`), { generation: 0 });
  const before = f.service.getState(); f.setTime(600000);
  await owner.persisted(turn('source-0'), { generation: 0 }); expect(f.service.getState()).toEqual(before);
  await owner.persisted(turn('fresh'), { generation: 0 });
  expect(Object.values(f.service.getState().preferences)[0]?.samples).toBe(2);
});
