import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { backendIntegrationFixture } from '../infrastructure/backend-integration-fixture';
import { ExternalAIProviderClient } from '../../src/infrastructure/ai/external-ai-provider-client';
import { CharacterStateService } from '../../src/application/services/character-state.service';
import { TouchReactionContext } from '../../src/application/services/touch-reaction-context';
import { AIEventRuntime } from '../../src/application/services/ai-event-runtime';
import { DialogueRuntime } from '../../src/application/services/dialogue-loop.service';

it('carries actual touch through Python/provider and published trace into v7 follow-up', async () => {
  const backend = await backendIntegrationFixture(); let now = 0;
  const character = new CharacterStateService({ now: () => 0, monotonicNow: () => now });
  const provider = new ExternalAIProviderClient({ baseUrl: 'http://127.0.0.1:8765', development: true, apiVersion: 7, now: () => now, fetch: backend.fetch });
  const scheduler = { setTimeout, clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>) };
  const trace = new TouchReactionContext(character, () => now);
  let dialogue: DialogueRuntime | undefined;
  const events = new AIEventRuntime({ provider, touchContext: trace, now: () => now, timestamp: () => new Date().toISOString(), createId: randomUUID,
    scheduler, character: () => character.getSnapshot(), gate: () => ({ identity: dialogue?.getIdentity() ?? null, allowed: true, memoryGeneration: 0, activeRunId: null, localSpeech: false }), publish: vi.fn(), transaction: commit => commit() });
  const chat = new DialogueRuntime({ provider, events, interactionEnabled: true, now: () => now, timestamp: () => new Date().toISOString(), createId: randomUUID, scheduler,
    getCharacterSnapshot: () => character.getSnapshot(), applyStimulus: s => { character.applyStimulus(s); }, beginThinking: vi.fn(), endThinking: vi.fn(),
    transaction: commit => commit(), offerIntent: vi.fn(), publish: () => { if (dialogue) events.observeDialogue(dialogue.getPresentation()); } });
  dialogue = chat;
  try {
    chat.replaceStream('s'); now = 30000; events.touch(character.beginTouch(1));
    await vi.waitFor(() => expect(events.getSpeech()).not.toBeNull(), { timeout: 8000 });
    const previous = trace.get(); expect(previous).toMatchObject({ action: 'touch', effect: 'neutral', reason: 'neutral' });
    expect(backend.requests[0]).toMatchObject({ path: '/v7/touch', body: { event: { type: 'user_touch', variant: 'touch' }, effectPolicy: 'eligible' } });
    chat.receive({ type: 'send', sequence: 1, streamId: 's', conversationId: chat.getPresentation().conversationId, text: 'Почему ты так отреагировала?' });
    await vi.waitFor(() => expect(chat.getPresentation().turn.phase).toBe('completed'), { timeout: 8000 });
    expect(chat.getPresentation().turn).toMatchObject({ outcome: { kind: 'success' } });
    expect(backend.requests[1]).toMatchObject({ path: '/v7/chat', body: { effectPolicy: 'suppressed', previousTouch: previous } });
    expect(backend.responses[1]?.upstreamCalls).toBe(2);
    expect(backend.responses[1]?.upstreamMessages.some(m => m.content.includes(previous!.publishedText))).toBe(true);
    expect(character.getState().relationship.friendship).toBe(6); // exactly one user_message legacy reward, no reply reward
    expect(trace.get()).toEqual(previous);
  } finally { chat.dispose(); events.dispose(); await backend.close(); }
}, 20000);
