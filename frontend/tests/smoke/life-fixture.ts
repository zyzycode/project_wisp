import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createDefaultCharacterState } from '../../src/application/services/character-state-factory';
import { projectCharacterMemory, restoreCharacterMemory } from '../../src/application/services/character-memory-snapshot';
import { SqliteMemoryStore } from '../../src/infrastructure/memory/sqlite-store';
import { causalEpisode } from '../../src/infrastructure/memory/causal-life-validation';
import { record, text } from '../../src/infrastructure/memory/validation-primitives';
import { snapshot } from '../../src/infrastructure/memory/validation';
import { PET_PRESENTATION_LAYOUT, calculateWindowRootPivotOffset } from '../../src/shared/pet-presentation-layout';
import { MockAIProvider } from '../../src/infrastructure/ai/mock-ai-provider';
import type { AIProviderRequest, AIProviderResponse } from '../../src/application/ports/ai-provider.interface';

export const rootPivotOffset = calculateWindowRootPivotOffset(PET_PRESENTATION_LAYOUT);

/** Only the external wording adapter is fake; Director/Character/body remain real. */
export function installLifeProvider() {
  const original = MockAIProvider.prototype.generateResponse;
  const requests: (NonNullable<AIProviderRequest['causalExpression']> & { readonly requestId: string })[] = [];
  MockAIProvider.prototype.generateResponse = async function (request): Promise<AIProviderResponse> {
    const expression = request.causalExpression;
    if (!expression) return original.call(this, request);
    if (requests.length >= 20) throw new Error('Native causal request bound exceeded');
    requests.push({ requestId: request.requestId, ...expression });
    const reply = expression.activity === 'cursor_game' && expression.cause === 'user_interrupted'
      ? 'Я хотела ещё поиграть. Мне нужна минутка.'
      : expression.activity === 'book' ? 'Я немного посидела и отдохнула.' : 'Я заметила это.';
    return { requestId: request.requestId, status: 'ok', reply: { text: reply, tone: 'quiet' },
      suggestedMood: 'neutral', confidence: 1 };
  };
  return { requests, dispose: () => { MockAIProvider.prototype.generateResponse = original; } };
}

const databasePath = (profile: string) => path.join(profile, 'memory', 'wisp.sqlite3');

/** Initial conditions, not remembered experience. Called before importing product Main. */
export function seedLifeProfile(profile: string) {
  if (profile !== process.env.WISP_SMOKE_PROFILE || existsSync(databasePath(profile))) {
    throw new Error('Life smoke requires the current fresh isolated profile');
  }
  const now = Date.now();
  const defaults = createDefaultCharacterState(() => now);
  const needs = { energy: 70, boredom: 80, play: 10, comfort: 20, attention: 40 };
  const seeded = { ...defaults, needs };
  mkdirSync(path.dirname(databasePath(profile)), { recursive: true });
  const store = SqliteMemoryStore.open(databasePath(profile), new Date(now).toISOString());
  try {
    const saved = store.execute({ id: 1, generation: 0, operation: 'saveSnapshot',
      payload: projectCharacterMemory(seeded, new Date(now).toISOString()) });
    if (!saved.ok) throw new Error(`Synthetic initial checkpoint rejected: ${saved.code}`);
  } finally {
    store.execute({ id: 2, generation: 0, operation: 'close', payload: null });
  }
  return { kind: 'synthetic_initial_conditions', needs, authoredIdentity: 'unchanged_default',
    seededEpisodes: 0, seededTerminals: 0, seededRewards: 0, snapshotVersion: 6 } as const;
}

/** Read-only evidence from the isolated profile; never closes/rewrites live sessions. */
export function readLifeEvidence(profile: string) {
  const db = new Database(databasePath(profile), { readonly: true, fileMustExist: true });
  try {
    const rows: unknown[] = db.prepare('SELECT payload FROM causal_life_episodes ORDER BY rowid LIMIT 101').all();
    if (rows.length > 100) throw new Error('Native synthetic history exceeded its evidence bound');
    const episodes = rows.map(value => causalEpisode(JSON.parse(text(record(value).payload, 16_384))));
    const raw = db.prepare("SELECT snapshot_json,updated_at FROM character_state WHERE id='singleton'").get();
    const envelope = raw === undefined ? null : record(raw);
    const persisted = envelope === null ? null : snapshot({
      ...record(JSON.parse(text(envelope.snapshot_json, 1_048_576))), updatedAt: envelope.updated_at,
    });
    const state = persisted === null ? null : restoreCharacterMemory(persisted,
      createDefaultCharacterState(Date.now), Date.now());
    return { episodes, checkpoint: state === null ? null : {
      needs: state.needs, relationship: state.relationship, preferences: state.preferences,
      ownBookInterestSources: state.ownBookInterestSources, ownGameInterestSources: state.ownGameInterestSources,
    } };
  } finally { db.close(); }
}
