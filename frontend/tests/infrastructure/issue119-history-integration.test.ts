import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { DialogueRuntime } from '../../src/application/services/dialogue-loop.service';
import { ExternalAIProviderClient } from '../../src/infrastructure/ai/external-ai-provider-client';
import { backendIntegrationFixture } from './backend-integration-fixture';
import { providerRequest } from './backend-ai-fixture';

it('carries an early topic through seven desktop turns to the actual provider payload', async () => {
  const bridge = await backendIntegrationFixture();
  const provider = new ExternalAIProviderClient({ baseUrl: 'https://backend.invalid', development: false, now: Date.now, fetch: bridge.fetch });
  const runtime = new DialogueRuntime({ getSemanticSleepState: () => 'awake', provider, interactionEnabled: true, now: Date.now, timestamp: () => new Date().toISOString(), createId: randomUUID,
    scheduler: { setTimeout, clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) },
    getCharacterSnapshot: () => providerRequest().characterSnapshot, transaction: commit => commit(), applyStimulus: vi.fn(),
    beginThinking: vi.fn(), endThinking: vi.fn(), publish: vi.fn(), offerIntent: () => ({ status: 'rejected', reason: 'disabled' }) });
  try {
    runtime.replaceStream('s');
    for (let sequence = 1; sequence <= 7; sequence++) {
      const text = sequence === 1 ? 'Обсуждаем первый телескоп.' : sequence === 7 ? 'Вернёмся к первому телескопу.' : `Уточнение ${sequence}`;
      expect(runtime.receive({ type: 'send', streamId: 's', conversationId: runtime.getPresentation().conversationId, sequence, text }).status).toBe('accepted');
      await vi.waitFor(() => expect(runtime.getPresentation().turn.phase).toBe('completed'), { timeout: 10000 });
      expect(runtime.getPresentation().turn).toMatchObject({ outcome: { kind: 'success' } });
    }
    const body = bridge.requests.at(-1)?.body;
    expect(body).toMatchObject({ messages: expect.arrayContaining([{ role: 'user', content: 'Обсуждаем первый телескоп.' }]) });
    const last = bridge.responses.at(-1)!;
    expect(last.status).toBe(200);
    const dialogue = last.upstreamMessages.slice(last.upstreamMessages.findIndex(message => message.content === 'Обсуждаем первый телескоп.'));
    expect(dialogue).toHaveLength(13);
    expect(dialogue[0]).toEqual({ role: 'user', content: 'Обсуждаем первый телескоп.' });
    expect(dialogue.at(-1)).toEqual({ role: 'user', content: 'Вернёмся к первому телескопу.' });
  } finally { runtime.dispose(); await bridge.close(); }
}, 20000);
