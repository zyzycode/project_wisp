import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { DialogueRuntime } from '../../src/application/services/dialogue-loop.service';
import type { AIProviderMemoryContext, ILocalMemoryRecall } from '../../src/application/ports/memory-knowledge.interface';
import { ExternalAIProviderClient } from '../../src/infrastructure/ai/external-ai-provider-client';
import { ContinuousVoiceClient } from '../../src/renderer/continuous-voice-client';
import { DialogueCommandClient } from '../../src/renderer/dialogue-command-client';
import type { BrainStateDTO, DialogueCommandDTO, VoiceInputApiBridge } from '../../src/shared/ipc-contracts';
import { parseDialogueCommand } from '../../src/shared/dialogue-ipc-validation';
import { backendIntegrationFixture } from '../infrastructure/backend-integration-fixture';
import { providerRequest } from '../infrastructure/backend-ai-fixture';

const historyText = 'Продолжим нашу беседу о телескопе.';
const utterance = '  Как мы выбирали телескоп?  ';
const memory: AIProviderMemoryContext = {
  facts: [{ key: 'user.display_name', value: 'Мария' }, { key: 'user.favorite_topic', value: 'Астрономия' }],
  episodes: [{ kind: 'dialogue', userText: 'Мы выбирали телескоп для наблюдения Луны.', assistantText: 'Мы сравнили два телескопа.', occurredAt: '2026-10-25T12:00:00.000Z' }],
  characterPreferences: [{ key: 'activity.cursor_game', value: 12, confidence: 0.8 }],
};
function withoutRequestId(value: unknown): unknown {
  if (!value || typeof value !== 'object' || !('requestId' in value)) throw new Error('Missing serialized chat request');
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'requestId'));
}

it('sends voice and keyboard through the same Dialogue pipeline with identical character, memory and history at the real backend provider boundary', async () => {
  const backend = await backendIntegrationFixture();
  async function branch(mode: 'keyboard' | 'voice') {
    const provider = new ExternalAIProviderClient({ baseUrl: 'https://backend.invalid', development: false, now: Date.now, fetch: backend.fetch });
    let character = providerRequest().characterSnapshot;
    const recall = vi.fn<ILocalMemoryRecall['recall']>(async () => ({ ok: true, value: memory }));
    const persisted = vi.fn();
    let commandClient: DialogueCommandClient | undefined;
    let voice: ContinuousVoiceClient | undefined;
    let revision = 0;
    const publish = () => {
      const snapshot: BrainStateDTO = {
        streamId: 'stream', revision: ++revision, sampledAtMs: 0,
        character: { needs: character.needs, synthesizedTone: character.synthesizedTone },
        activity: null,
        motion: { phase: 'grounded', rootScreenPosition: { x: 100, y: 100 }, velocityPxPerSec: { x: 0, y: 0 }, positionAuthority: 'voluntary' },
        visualIntent: { episodeId: 'episode', episodeSequence: 1, episodeStartedAtMs: 0, kind: 'idle_blink', category: 'idle', priority: 'low', interrupt: 'yes', loop: 'until_replaced', emotionalTone: 'neutral' },
        dialogue: runtime.getPresentation(),
      };
      commandClient?.accept(snapshot);
      voice?.setCanSubmit(commandClient?.getState().canSubmit === true);
    };
    const runtime = new DialogueRuntime({
      getSemanticSleepState: () => 'awake', provider, interactionEnabled: true,
      memory: { generation: () => 0, recall: { recall }, completed: persisted },
      now: Date.now, timestamp: () => '2026-10-30T00:00:00.000Z', createId: randomUUID,
      scheduler: { setTimeout, clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) },
      getCharacterSnapshot: () => character, transaction: commit => commit(), applyStimulus: vi.fn(),
      beginThinking: vi.fn(), endThinking: vi.fn(), publish,
      offerIntent: () => ({ status: 'rejected', reason: 'disabled' }),
    });
    const postDialogueCommand = vi.fn(async (command: DialogueCommandDTO) => runtime.receive(parseDialogueCommand(command)));
    const client = new DialogueCommandClient({ postDialogueCommand });
    commandClient = client;
    const sharedSend = client.send;
    try {
      runtime.replaceStream('stream');
      expect(await sharedSend(historyText)).toBe(true);
      await vi.waitFor(() => expect(runtime.getPresentation().turn).toMatchObject({ phase: 'completed', outcome: { kind: 'success' } }), { timeout: 10000 });
      const previous = runtime.getPresentation().turn;
      if (previous.phase !== 'completed') throw new Error('History seed did not complete');
      character = { ...character, needs: { ...character.needs, energy: 43 }, relationship: { ...character.relationship, friendship: 237 } };
      publish();
      if (mode === 'keyboard') expect(await sharedSend(utterance)).toBe(true);
      else {
        let onSamples: (samples: Float32Array) => void = () => undefined;
        const voiceBridge: VoiceInputApiBridge = {
          enableAtStartup: async () => ({ ok: true, value: null }),
          readStatus: async () => ({ ok: true, value: { state: 'ready', downloadedBytes: 1, totalBytes: 1 } }),
          prepare: async () => { throw new Error('Runtime model download must not run'); },
          enable: async () => ({ ok: true, value: null }), disable: async () => ({ ok: true, value: null }),
          onDisabled: () => () => undefined,
          begin: async () => ({ ok: true, value: { requestId: 'voice-request' } }),
          transcribe: async () => ({ ok: true, value: { text: utterance } }),
          cancel: async () => ({ ok: true, value: null }),
        };
        voice = new ContinuousVoiceClient(voiceBridge, sharedSend, async (_signal, samples) => { onSamples = samples; return { cancel: vi.fn() }; });
        voice.setContext({ streamId: 'stream', conversationId: runtime.getPresentation().conversationId });
        voice.setCanSubmit(client.getState().canSubmit);
        await voice.enable('ru');
        for (let i = 0; i < 20; i++) onSamples(new Float32Array(320).fill(0.1));
        for (let i = 0; i < 40; i++) onSamples(new Float32Array(320));
      }
      await vi.waitFor(() => expect(postDialogueCommand).toHaveBeenCalledTimes(2));
      await vi.waitFor(() => expect(runtime.getPresentation().turn).toMatchObject({ phase: 'completed', outcome: { kind: 'success' } }), { timeout: 10000 });
      const request = backend.requests.at(-1);
      const response = backend.responses.at(-1);
      expect(request?.path).toBe('/v1/chat');
      expect(request?.body).toMatchObject({
        event: { type: 'user_message' }, locale: 'ru', memory,
        character: { needs: character.needs, relationship: character.relationship, personality: character.personality, intimacy: character.intimacy },
        messages: [{ role: 'user', content: historyText }, { role: 'assistant', content: previous.replyText }, { role: 'user', content: utterance.trim() }],
      });
      expect(postDialogueCommand.mock.calls[1]?.[0]).toMatchObject({ type: 'send', text: utterance.trim() });
      expect(recall).toHaveBeenLastCalledWith({ text: utterance.trim(), excludedMessageIds: expect.any(Array) }, { generation: 0 });
      expect(persisted).toHaveBeenCalledTimes(2);
      expect(response?.status).toBe(200);
      const prompt = response?.upstreamMessages.map(message => message.content).join('\n') ?? '';
      expect(prompt).toContain('Мария');
      expect(prompt).toContain('Мы выбирали телескоп для наблюдения Луны.');
      expect(prompt).toContain('Мы сравнили два телескопа.');
      expect(response?.upstreamMessages).toEqual(expect.arrayContaining([{ role: 'user', content: historyText }, { role: 'user', content: utterance.trim() }]));
      return { request: withoutRequestId(request?.body), messages: response?.upstreamMessages };
    } finally { voice?.disable(); runtime.dispose(); }
  }
  try {
    const keyboard = await branch('keyboard');
    const voice = await branch('voice');
    expect(voice).toEqual(keyboard);
    expect(backend.requests).toHaveLength(4);
    expect(backend.responses.at(-1)?.upstreamCalls).toBe(4);
  } finally { await backend.close(); }
}, 30000);
