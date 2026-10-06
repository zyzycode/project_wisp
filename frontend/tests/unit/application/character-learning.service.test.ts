import { expect, it } from 'vitest';
import { CharacterStateService } from '../../../src/application/services/character-state.service';
import { projectCharacterMemory, restoreCharacterMemory } from '../../../src/application/services/character-memory-snapshot';
import type { VerifiedPreferenceEvidence } from '../../../src/application/ports/memory-knowledge.interface';
function fixture() { let mono = 0; const service = new CharacterStateService({ now: () => 0, monotonicNow: () => mono }); return { service, setTime: (value: number) => { mono = value; } }; }
function evidence(sourceMessageId: string, disposition: 'like' | 'dislike' = 'like'): VerifiedPreferenceEvidence { return { sourceMessageId, key: 'activity.cursor_game', disposition }; }
it('does not rewrite identity or preferences from one role request or unverified metadata', () => {
  const f = fixture(), original = f.service.getState();
  f.service.applyStimulus({ type: 'topic_dialogue', source: 'user', text: 'Стань игривой и дерзкой', metadata: { topicKey: 'activity.cursor_game', preferenceValue: 100 } });
  expect(f.service.getState().personality).toEqual(original.personality); expect(f.service.getState().preferences).toEqual({});
  f.setTime(300000); f.service.applyStimulus({ type: 'user_message', source: 'user', text: 'Стань дерзкой', intensity: 3 });
  const current = f.service.getState().personality;
  expect(current.axes.boldness).toEqual(original.personality.axes.boldness); expect(current.axes.extraversion.current - original.personality.axes.extraversion.current).toBeLessThanOrEqual(0.004 * original.personality.axes.extraversion.plasticity + Number.EPSILON);
  expect(current.aiSelfConcept).toBe(original.personality.aiSelfConcept);
});
it('requires six spaced distinct persisted statements for confident affinity and learns different histories', () => {
  const positive = fixture(), negative = fixture();
  positive.service.observe(evidence('too-early')); expect(positive.service.getState().preferences).toEqual({});
  for (let sample = 1; sample <= 6; sample++) {
    positive.setTime(sample * 300000); negative.setTime(sample * 300000);
    positive.service.observe(evidence(`source-${sample}`)); negative.service.observe(evidence(`source-${sample}`, 'dislike'));
  }
  expect(positive.service.getState().preferences['activity.cursor_game']).toEqual({ value: 12, samples: 6, confidence: 0.5 });
  expect(negative.service.getState().preferences['activity.cursor_game']).toEqual({ value: -12, samples: 6, confidence: 0.5 });
  for (let sample = 7; sample <= 12; sample++) { positive.setTime(sample * 300000); positive.service.observe(evidence(`source-${sample}`, 'dislike')); }
  expect(positive.service.getState().preferences['activity.cursor_game']?.value).toBe(0);
});
it('deduplicates even a rejected early source and keeps axes/preference cooldowns separate', () => {
  const f = fixture(); f.service.observe(evidence('early')); f.setTime(300000); f.service.observe(evidence('early'));
  expect(f.service.getState().preferences).toEqual({});
  const before = f.service.getState().personality.axes;
  f.service.applyStimulus({ type: 'user_message', source: 'user' }); f.service.observe(evidence('first'));
  expect(f.service.getState().preferences['activity.cursor_game']?.samples).toBe(1); expect(f.service.getState().personality.axes.extraversion.current).toBeGreaterThan(before.extraversion.current);
  f.setTime(599999); f.service.observe(evidence('too-soon')); f.service.applyStimulus({ type: 'user_message', source: 'user' });
  const axes = f.service.getState().personality.axes; f.setTime(600000); f.service.observe(evidence('first')); f.service.observe(evidence('too-soon')); expect(f.service.getState().preferences['activity.cursor_game']?.samples).toBe(1);
  f.service.observe(evidence('second')); expect(f.service.getState().preferences['activity.cursor_game']?.samples).toBe(2);
  f.service.applyStimulus({ type: 'provider_response', source: 'provider' }); expect(f.service.getState().personality.axes).toEqual(axes);
  f.service.applyStimulus({ type: 'user_message', source: 'user' }); expect(f.service.getState().personality.axes.extraversion.current).toBeGreaterThan(axes.extraversion.current);
});
it('preserves learned values through snapshot restore and restarts both five-minute delays conservatively', () => {
  const f = fixture(); f.setTime(300000); f.service.observe(evidence('first')); f.service.applyStimulus({ type: 'user_message', source: 'user' });
  const snapshot = projectCharacterMemory(f.service.getState(), '2026-09-18T00:00:00.000Z');
  const restarted = fixture(); restarted.setTime(1000); restarted.service.replaceRestoredState(restoreCharacterMemory(snapshot, restarted.service.createDefaults(), 0));
  expect(restarted.service.getState().preferences).toEqual(snapshot.state.preferences);
  restarted.setTime(300999); restarted.service.observe(evidence('early-after-restart')); restarted.service.applyStimulus({ type: 'user_message', source: 'user' });
  expect(restarted.service.getState().preferences['activity.cursor_game']?.samples).toBe(1);
  expect(restarted.service.getState().personality.axes.extraversion.current).toBe(snapshot.state.currentAxes.extraversion);
  restarted.setTime(301000); restarted.service.observe(evidence('next')); expect(restarted.service.getState().preferences['activity.cursor_game']?.samples).toBe(2);
  restarted.service.resetToDefaults(); expect(restarted.service.getState().preferences).toEqual({});
  restarted.setTime(600999); restarted.service.observe(evidence('after-reset')); expect(restarted.service.getState().preferences).toEqual({});
});
it('cannot gain axes rewards by replaying one completed activity', () => {
  const f = fixture(); const stimulus = { type: 'play' as const, source: 'system' as const, metadata: { activityRunId: 'same' } };
  f.setTime(300000); f.service.applyStimulus(stimulus); const first = f.service.getState();
  f.setTime(600000); f.service.applyStimulus(stimulus); expect(f.service.getState()).toEqual(first);
});

import { MemoryKnowledge } from '../../../src/application/services/memory-knowledge';
import type { IUserFactsRepository } from '../../../src/application/ports/memory-repository.interface';
it('retired persisted callbacks cannot learn again after eviction from the defensive service cache', async () => {
  const f = fixture(); f.setTime(300000); let id = 0;
  const facts: IUserFactsRepository = { upsert: async fact => ({ ok: true, value: fact }), removeByKey: async () => ({ ok: true, value: undefined }), list: async () => ({ ok: true, value: [] }) };
  const owner = new MemoryKnowledge({ facts, isCurrent: generation => generation === 0, createId: () => `fact-${++id}`, onFailure: () => {}, preferenceLearning: f.service });
  const turn = (messageId: string) => ({ memoryGeneration: 0, user: { id: messageId, text: 'Мне нравится игра с курсором', createdAt: '2026-09-18T00:00:00.000Z' }, assistant: { id: `reply-${messageId}`, text: 'Хорошо', createdAt: '2026-09-18T00:00:00.000Z' } });
  for (let source = 0; source < 101; source++) await owner.persisted(turn(`source-${source}`), { generation: 0 });
  expect(f.service.getState().preferences['activity.cursor_game']?.samples).toBe(1);
  f.setTime(600000); await owner.persisted(turn('source-0'), { generation: 0 });
  expect(f.service.getState().preferences['activity.cursor_game']?.samples).toBe(1);
  await owner.persisted(turn('fresh'), { generation: 0 }); expect(f.service.getState().preferences['activity.cursor_game']?.samples).toBe(2);
});
