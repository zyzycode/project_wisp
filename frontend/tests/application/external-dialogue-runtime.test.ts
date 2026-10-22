import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DialogueRuntime } from '../../src/application/services/dialogue-loop.service';
import { ExternalAIProviderClient } from '../../src/infrastructure/ai/external-ai-provider-client';
import { providerRequest } from '../infrastructure/backend-ai-fixture';

const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function setup(fetcher?: typeof fetch) {
  const requests: string[] = [];
  const transport = vi.fn(fetcher ?? (async (_url, init) => {
    const parsed: unknown = JSON.parse(String(init?.body));
    if (!parsed || typeof parsed !== 'object' || !('requestId' in parsed) || typeof parsed.requestId !== 'string') throw new TypeError();
    requests.push(parsed.requestId);
    return new Response(JSON.stringify({ requestId: parsed.requestId, text: 'Привет!', appraisal: { category: 'neutral', intensity: 'low', confidence: 'clear' }, decision: { behavior: 'play', confidence: 1 } }), { headers: { 'Content-Type': 'application/json' } });
  }));

  const provider = new ExternalAIProviderClient({ baseUrl: 'https://backend.example', development: false, now: Date.now, fetch: transport });
  let id = 0;
  const applyStimulus = vi.fn(), offerIntent = vi.fn(), publish = vi.fn(), endThinking = vi.fn();
  const runtime = new DialogueRuntime({ interactionEnabled: true, provider, now: Date.now, timestamp: () => new Date().toISOString(),
    createId: () => `00000000-0000-4000-8000-${(++id).toString().padStart(12, '0')}`,
    scheduler: { setTimeout, clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) },
    getCharacterSnapshot: () => providerRequest().characterSnapshot, applyStimulus, offerIntent, publish,
    beginThinking: vi.fn(), endThinking, transaction: commit => commit() });
  runtime.replaceStream('stream');
  const command = (sequence: number) => ({ type: 'send', text: 'Привет', sequence, streamId: 'stream', conversationId: runtime.getPresentation().conversationId });
  return { runtime, transport, requests, command, applyStimulus, offerIntent, publish, endThinking };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
afterEach(() => vi.useRealTimers());
it('allows more than 100 sends without minute or session quotas', async () => {
  const f = setup();
  for (let i = 1; i <= 105; i++) {
    expect(f.runtime.receive(f.command(i)).status).toBe('accepted'); await flush();
    expect(f.runtime.getPresentation().canSubmit).toBe(true);
    expect(f.runtime.getPresentation().submissionMessage).toBeUndefined();
  }
  expect(f.transport).toHaveBeenCalledTimes(105); expect(new Set(f.requests).size).toBe(105);
});
it('keeps reset/reload available while rejecting invalid or overlapping dialogue commands', async () => {
  const f = setup();
  for (let i = 1; i <= 5; i++) { f.runtime.receive(f.command(i)); await flush(); }
  expect(f.runtime.receive({ ...f.command(6), text: '' }).status).toBe('rejected');
  f.runtime.receive(f.command(6)); expect(f.runtime.receive(f.command(7))).toEqual({ status: 'rejected', reason: 'busy' }); await flush();
  const { text: _text, ...meta } = f.command(8); f.runtime.receive({ ...meta, type: 'reset' });
  expect(f.runtime.getPresentation().canSubmit).toBe(true);
  f.runtime.replaceStream('next'); expect(f.runtime.getPresentation().canSubmit).toBe(true);
  expect(f.transport).toHaveBeenCalledTimes(6);
  await vi.advanceTimersByTimeAsync(60_000); expect(f.runtime.getPresentation().canSubmit).toBe(true);
});
it('allows an immediate new user request after server failure without automatic retries', async () => {
  let fail = true;
  const f = setup(async (_url, init) => {
    const body: { requestId: string } = JSON.parse(String(init?.body));
    return new Response(JSON.stringify(fail
      ? { requestId: body.requestId, error: { code: 'upstream_unavailable' } }
      : { requestId: body.requestId, text: 'Снова работаю', appraisal: { category: 'neutral', intensity: 'low', confidence: 'clear' } }),
      { status: fail ? 503 : 200, headers: { 'Content-Type': 'application/json' } });
  });
  f.runtime.receive(f.command(1)); await flush();
  expect(f.runtime.getPresentation().canSubmit).toBe(true);
  expect(f.transport).toHaveBeenCalledTimes(1);
  fail = false;
  expect(f.runtime.receive(f.command(2)).status).toBe('accepted'); await flush();
  expect(f.runtime.getPresentation().turn).toMatchObject({ phase: 'completed', replyText: 'Снова работаю' });
  expect(f.transport).toHaveBeenCalledTimes(2);
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
  resolve(new Response(JSON.stringify({ requestId, text: 'late', decision: { behavior: 'play', confidence: 1 } }), { headers: { 'Content-Type': 'application/json' } }));
  await flush(); expect(f.offerIntent).not.toHaveBeenCalled(); expect(f.applyStimulus).toHaveBeenCalledTimes(1);
  expect(f.runtime.getPresentation().turn.phase).toBe('idle');
  if (action === 'dispose') expect(f.publish).toHaveBeenCalledTimes(publishes);
  else expect(f.runtime.getPresentation().canSubmit).toBe(true);
});
it('ends thinking at the 12s timeout and immediately allows another user request', async () => {
  const f = setup(async () => new Promise<Response>(() => undefined));
  f.runtime.receive(f.command(1)); await flush();
  await vi.advanceTimersByTimeAsync(12_000);
  expect(f.runtime.getPresentation()).toMatchObject({ canSubmit: true, turn: { phase: 'completed', outcome: { kind: 'fallback', reason: 'timeout' } } });
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
