import { expect, it } from 'vitest';
import { projectBackendRequest } from '../../src/infrastructure/ai/backend-request-projection';
import { parseBackendSuccess, parseBackendError } from '../../src/infrastructure/ai/backend-response-validation';
import { fixture, wire, providerRequest } from './backend-ai-fixture';
import { CharacterStateService } from '../../src/application/services/character-state.service';
import { createCharacterSnapshot, shyDreamGirlPreset } from '../../src/domain/character';
import { projectCharacterMemory, restoreCharacterMemory } from '../../src/application/services/character-memory-snapshot';

it('projects exactly the shared backend request fixture and accepts both shared response outcomes', () => {
  expect(projectBackendRequest(providerRequest())).toEqual(wire);
  expect(parseBackendSuccess(fixture('response.success.json'), wire.requestId)).toMatchObject({ text: 'Привет! Чем займёмся?' });
  expect(parseBackendError(fixture('response.error.json'), wire.requestId, 503)).toMatchObject({ error: { code: 'upstream_unavailable' } });
});
it('copies only allowed fields, preserves self concept, defaults locale, optional boredom absence and last three pairs', () => {
  const request = providerRequest();
  Object.assign(request.characterSnapshot.needs, { boredom: undefined });
  Object.assign(request.characterSnapshot.needs, { privateScreenData: 42 });
  Object.assign(request.characterSnapshot.personality, { aiSelfConcept: 'я'.repeat(500) });
  request.locale = 'unsupported';
  request.recentContext = Array.from({ length: 8 }, (_, index) => ({ role: index % 2 === 0 ? 'user' : 'wisp', text: `${index}`, createdAt: 'secret' }));
  const projected = projectBackendRequest(request);
  expect(projected.character.needs).toEqual({ energy: 80, attention: 50, play: 60, comfort: 80 });
  expect(projected.character.personality.aiSelfConcept).toHaveLength(500);
  expect(projected.locale).toBe('ru');
  expect(projected.messages).toEqual([...Array.from({ length: 6 }, (_, index) => ({ role: index % 2 === 0 ? 'user' : 'assistant', content: `${index + 2}` })), { role: 'user', content: 'Привет!' }]);
  expect(JSON.stringify(projected)).not.toMatch(/local-only|privateScreenData|secret/u);
  Object.assign(request.characterSnapshot.needs, { energy: 0 });
  expect(projected.character.needs.energy).toBe(80);
});
it.each(['я'.repeat(501), '😀'.repeat(250) + 'x', 'x'.repeat(500) + ' '])('rejects overflowing self concept without truncation', aiSelfConcept => {
  const request = providerRequest();
  Object.assign(request.characterSnapshot.personality, { aiSelfConcept });
  expect(() => projectBackendRequest(request)).toThrow();
  expect(request.characterSnapshot.personality.aiSelfConcept).toBe(aiSelfConcept);
});
it.each(['я'.repeat(500), '😀'.repeat(250)])('preserves the complete 500 UTF-16 unit boundary', aiSelfConcept => {
  const request = providerRequest();
  Object.assign(request.characterSnapshot.personality, { aiSelfConcept });
  expect(projectBackendRequest(request).character.personality.aiSelfConcept).toBe(aiSelfConcept);
});
it.each([0, 600])('keeps the installed canonical card across state changes and restore at trust %s', friendship => {
  const defaults = new CharacterStateService({ now: () => 0 }).getState();
  const state = new CharacterStateService({ now: () => 0 }).getState();
  state.relationship.friendship = friendship;
  state.needs = { ...state.needs, energy: 10 };
  state.personality.axes.playfulness.current = 0.7;
  const checkpoint = projectCharacterMemory(state, '2026-10-17T00:00:00.000Z');
  const restored = restoreCharacterMemory(checkpoint, defaults, 1);
  const snapshot = createCharacterSnapshot(restored);
  expect(snapshot.personality.presetId).toBe(shyDreamGirlPreset.id);
  expect(snapshot.personality.aiSelfConcept).toBe(shyDreamGirlPreset.aiSelfConcept);
  expect(snapshot.personality.aiSelfConcept.length).toBeLessThanOrEqual(500);
  expect(snapshot.personality.traits.playfulness).toBe(0.7);
  expect(snapshot.synthesizedTone).toBe('sleepy');
  expect(projectBackendRequest({ ...providerRequest(), characterSnapshot: snapshot }).character).toEqual(snapshot);
  expect(checkpoint.state).not.toHaveProperty('aiSelfConcept');
  expect(restored.personality.axes.playfulness.base).toBe(shyDreamGirlPreset.axes.playfulness.base);
});
it.each([-1, 101, NaN, Infinity, '50', null])('rejects invalid numeric input before transport: %s', value => {
  const request = providerRequest();
  Object.assign(request.characterSnapshot.needs, { energy: value });
  expect(() => projectBackendRequest(request)).toThrow();
});
it('accepts inclusive bounds and rejects invalid booleans, IDs, trait ranges and incomplete context', () => {
  const request = providerRequest();
  Object.assign(request.characterSnapshot.needs, { energy: 0 }); Object.assign(request.characterSnapshot.needs, { comfort: 100 });
  Object.assign(request.characterSnapshot.relationship, { friendship: 1000 }); Object.assign(request.characterSnapshot.personality.traits, { boldness: 1 });
  expect(() => projectBackendRequest(request)).not.toThrow();
  Object.assign(request.characterSnapshot.intimacy, { userConsentEnabled: 1 });
  expect(() => projectBackendRequest(request)).toThrow();
  expect(() => projectBackendRequest({ ...providerRequest(), requestId: 'local-id' })).toThrow();
  const trait = providerRequest(); Object.assign(trait.characterSnapshot.personality.traits, { shyness: 1.01 });
  expect(() => projectBackendRequest(trait)).toThrow();
  expect(() => projectBackendRequest({ ...providerRequest(), recentContext: [{ role: 'user', text: 'hello', createdAt: '' }] })).toThrow();
});
it.each([undefined, null, {}, { behavior: 'unknown', confidence: 1 }, { behavior: 'respond', confidence: 1.1 }, { behavior: 'respond', confidence: 1, coordinates: [1, 2] }])('keeps valid text while discarding invalid/absent decision %j', decision => {
  expect(parseBackendSuccess({ version: 1, requestId: wire.requestId, text: 'hello', decision }, wire.requestId)).toEqual({ version: 1, requestId: wire.requestId, text: 'hello' });
});
it.each([{ version: 2 }, { requestId: 'wrong' }, { extra: 1 }, { text: '' }, { text: 'x'.repeat(2001) }, { text: '\u0000' }])('rejects malformed success envelope %j', patch => {
  expect(() => parseBackendSuccess({ version: 1, requestId: wire.requestId, text: 'hello', ...patch }, wire.requestId)).toThrow();
});
it('validates error correlation, shape and HTTP/code pair while ignoring malformed 429 retry hints', () => {
  expect(() => parseBackendError(fixture('response.error.json'), wire.requestId, 429)).toThrow();
  expect(() => parseBackendError({ version: 1, requestId: null, error: { code: 'invalid_request' } }, wire.requestId, 400)).toThrow();
  expect(() => parseBackendError({ version: 1, requestId: wire.requestId, error: { code: 'rate_limited', message: 'secret' } }, wire.requestId, 429)).toThrow();
  expect(parseBackendError({ version: 1, requestId: wire.requestId, error: { code: 'rate_limited', retryAfterMs: -1 } }, wire.requestId, 429).error).toEqual({ code: 'rate_limited' });
});
