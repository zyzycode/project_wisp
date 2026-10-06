import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DialogueRuntime } from '../../src/application/services/dialogue-loop.service';
import { AIRequestControl } from '../../src/application/services/ai-request-control';
import { ExternalAIProviderClient } from '../../src/infrastructure/ai/external-ai-provider-client';
import { providerRequest } from '../infrastructure/backend-ai-fixture';

const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function setup(fetcher?: typeof fetch) {
  const requests: string[] = [];
  const transport = vi.fn(fetcher ?? (async (_url, init) => {
    const parsed: unknown = JSON.parse(String(init?.body));
    if (!parsed || typeof parsed !== 'object' || !('requestId' in parsed) || typeof parsed.requestId !== 'string') throw new TypeError();
    requests.push(parsed.requestId);
    return new Response(JSON.stringify({ version: 1, requestId: parsed.requestId, text: 'Привет!', decision: { behavior: 'play', confidence: 1 } }), { headers: { 'Content-Type': 'application/json' } });
  }));
  const requestControl = new AIRequestControl();
  const provider = new ExternalAIProviderClient({ baseUrl: 'https://backend.example', development: false, now: Date.now, requestControl, fetch: transport });
  let id = 0;
  const applyStimulus = vi.fn(), offerIntent = vi.fn(), publish = vi.fn(), endThinking = vi.fn();
  const runtime = new DialogueRuntime({ provider, requestControl, now: Date.now, timestamp: () => new Date().toISOString(),
    createId: () => `00000000-0000-4000-8000-${(++id).toString().padStart(12, '0')}`,
    scheduler: { setTimeout, clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) },
    getCharacterSnapshot: () => providerRequest().characterSnapshot, applyStimulus, offerIntent, publish,
    beginThinking: vi.fn(), endThinking, transaction: commit => commit() });
  runtime.replaceStream('stream');
  const command = (sequence: number) => ({ type: 'send', text: 'Привет', sequence, streamId: 'stream', conversationId: runtime.getPresentation().conversationId });
  return { runtime, requestControl, transport, requests, command, applyStimulus, offerIntent, publish, endThinking };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
afterEach(() => vi.useRealTimers());
it('rejects the seventh send atomically and republishes canSubmit at expiry without another network call', async () => {
  const f = setup();
  for (let i = 1; i <= 6; i++) { expect(f.runtime.receive(f.command(i)).status).toBe('accepted'); await flush(); }
  expect(f.transport).toHaveBeenCalledTimes(6); expect(new Set(f.requests).size).toBe(6);
  expect(f.runtime.getPresentation().canSubmit).toBe(false);
  expect(f.runtime.receive(f.command(7))).toEqual({ status: 'rejected', reason: 'unavailable' });
  expect(f.applyStimulus).toHaveBeenCalledTimes(12);
  f.publish.mockClear(); await vi.advanceTimersByTimeAsync(59_999); expect(f.runtime.getPresentation().canSubmit).toBe(false);
  expect(f.runtime.getPresentation().submissionMessage).toBeDefined();
  await vi.advanceTimersByTimeAsync(1); expect(f.runtime.getPresentation().submissionMessage).toBeUndefined(); expect(f.runtime.getPresentation().canSubmit).toBe(true); expect(f.publish).toHaveBeenCalled();
  expect(f.transport).toHaveBeenCalledTimes(6); expect(f.runtime.receive(f.command(8)).status).toBe('accepted'); await flush();
});
it('keeps counters after reset/reload and does not charge invalid or busy commands', async () => {
  const f = setup();
  for (let i = 1; i <= 5; i++) { f.runtime.receive(f.command(i)); await flush(); }
  expect(f.runtime.receive({ ...f.command(6), text: '' }).status).toBe('rejected');
  f.runtime.receive(f.command(6)); expect(f.runtime.receive(f.command(7))).toEqual({ status: 'rejected', reason: 'busy' }); await flush();
  const { text: _text, ...meta } = f.command(8); f.runtime.receive({ ...meta, type: 'reset' });
  expect(f.runtime.getPresentation().canSubmit).toBe(false);
  f.runtime.replaceStream('next'); expect(f.runtime.getPresentation().canSubmit).toBe(false);
  expect(f.transport).toHaveBeenCalledTimes(6);
  await vi.advanceTimersByTimeAsync(60_000); expect(f.runtime.getPresentation().canSubmit).toBe(true);
});
it('publishes the session cap on the hundredth actual send without replacing its reply', async () => {
  let resolve!: (response: Response) => void; let requestId = '';
  const f = setup(async (_url, init) => {
    const value: { requestId: string } = JSON.parse(String(init?.body)); requestId = value.requestId;
    return new Promise<Response>(yes => { resolve = yes; });
  });
  for (let i = 0; i < 99; i++) f.requestControl.recordSubmission(i * 60_000);
  vi.setSystemTime(100 * 60_000);
  const presentations: ReturnType<typeof f.runtime.getPresentation>[] = [];
  f.publish.mockImplementation(() => { presentations.push(f.runtime.getPresentation()); });
  expect(f.runtime.receive(f.command(1)).status).toBe('accepted'); await flush();
  const submissionMessage = 'Лимит сообщений на этот запуск исчерпан. Новый диалог станет доступен после перезапуска приложения.';
  expect(presentations.at(-1)).toMatchObject({ canSubmit: false, submissionMessage, turn: { phase: 'thinking' } });
  resolve(new Response(JSON.stringify({ version: 1, requestId, text: 'Сотый ответ', decision: { behavior: 'play', confidence: 1 } }), { headers: { 'Content-Type': 'application/json' } }));
  await flush();
  expect(f.runtime.getPresentation()).toMatchObject({ canSubmit: false, submissionMessage, turn: { phase: 'completed', replyText: 'Сотый ответ' } });
  expect(f.runtime.receive(f.command(2))).toEqual({ status: 'rejected', reason: 'unavailable' });
  expect(f.runtime.getPresentation().turn).toMatchObject({ phase: 'completed', replyText: 'Сотый ответ' });
  expect(f.applyStimulus).toHaveBeenCalledTimes(2);
  const { text: _text, ...meta } = f.command(3); f.runtime.receive({ ...meta, type: 'reset' });
  expect(f.runtime.getPresentation()).toMatchObject({ canSubmit: false, submissionMessage, turn: { phase: 'idle' } });
  f.runtime.replaceStream('next'); expect(f.runtime.getPresentation().submissionMessage).toBe(submissionMessage);
  expect(f.transport).toHaveBeenCalledTimes(1);
});
it.each(['reset', 'reload', 'dispose'])('ignores successful late transport output after %s and keeps its guard until transport settlement', async action => {
  let resolve!: (response: Response) => void; let requestId = '';
  const pending = new Promise<Response>(yes => { resolve = yes; });
  const f = setup(async (_url, init) => {
    const value: { requestId: string } = JSON.parse(String(init?.body)); requestId = value.requestId; return pending;
  });
  f.runtime.receive(f.command(1)); await flush();
  if (action === 'reset') { const { text: _text, ...meta } = f.command(2); f.runtime.receive({ ...meta, type: 'reset' }); }
  if (action === 'reload') f.runtime.replaceStream('stream');
  if (action === 'dispose') f.runtime.dispose();
  expect(f.runtime.getPresentation().canSubmit).toBe(false);
  const publishes = f.publish.mock.calls.length;
  resolve(new Response(JSON.stringify({ version: 1, requestId, text: 'late', decision: { behavior: 'play', confidence: 1 } }), { headers: { 'Content-Type': 'application/json' } }));
  await flush(); expect(f.offerIntent).not.toHaveBeenCalled(); expect(f.applyStimulus).toHaveBeenCalledTimes(1);
  expect(f.runtime.getPresentation().turn.phase).toBe('idle');
  if (action === 'dispose') expect(f.publish).toHaveBeenCalledTimes(publishes);
  else expect(f.runtime.getPresentation().canSubmit).toBe(true);
});
it('ends thinking at the 12s transport timeout, applies cooldown, and never offers a late model behavior', async () => {
  const f = setup(async () => new Promise<Response>(() => undefined));
  f.runtime.receive(f.command(1)); await flush();
  await vi.advanceTimersByTimeAsync(12_000);
  expect(f.runtime.getPresentation()).toMatchObject({ canSubmit: false, turn: { phase: 'completed', outcome: { kind: 'fallback', reason: 'timeout' } } });
  expect(f.endThinking).toHaveBeenCalledTimes(1); expect(f.offerIntent).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(30_000); expect(f.runtime.getPresentation().canSubmit).toBe(true); expect(f.transport).toHaveBeenCalledTimes(1);
});
it('retains behavior arbitration metadata, while server outage only adds the admitted user stimulus', async () => {
  const success = setup(); success.runtime.receive(success.command(1)); await flush();
  expect(success.offerIntent).toHaveBeenCalledWith(expect.objectContaining({ intent: expect.objectContaining({ kind: 'play', source: 'provider' }), generation: 1 }));
  const outage = setup(async () => { throw new Error('outage'); }); outage.runtime.receive(outage.command(1)); await flush();
  expect(outage.applyStimulus).toHaveBeenCalledTimes(1); expect(outage.offerIntent).not.toHaveBeenCalled();
  expect(outage.runtime.getPresentation().turn).toMatchObject({ phase: 'completed', outcome: { reason: 'offline' } });
});
