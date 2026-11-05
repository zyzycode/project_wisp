import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WindowHelpRuntime } from '../../src/application/services/window-help-runtime';
import { InitiativeBudget } from '../../src/application/services/initiative-budget';
import { InitiativeSessionControls } from '../../src/application/services/initiative-session-controls';
import { AIEventRuntime } from '../../src/application/services/ai-event-runtime';
import { ExternalAIProviderClient } from '../../src/infrastructure/ai/external-ai-provider-client';
import { emptyMemoryContext } from '../../src/application/services/memory-recall';
import { providerRequest } from '../infrastructure/backend-ai-fixture';
import type { VerifiedWindowHelpTarget, WindowHelpChoice } from '../../src/application/ports/window-help.interface';
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1200000); });
afterEach(() => vi.useRealTimers());
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function fixture() {
  const id = '00000000-0000-4000-8000-000000000131';
  let helper: WindowHelpRuntime, events: AIEventRuntime, causal = false, boredom = 70;
  const target = (): VerifiedWindowHelpTarget => ({ surfaceId: 'window', sourceEpoch: 1,
    policyGeneration: 0, geometrySignature: 'same', capturedAtMs: Date.now(),
    preview: { region: 'upper_center', left: .2, top: .1, width: .4, height: .3 } });
  const controls = new InitiativeSessionControls({ streamId: () => 's', conditions: () => ({
    capability: true, memory: true, quiet: false, sleeping: false, away: false, busy: false,
  }), revoke: () => { helper?.cancel(); events?.invalidate(); } });
  const budget = new InitiativeBudget();
  const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ requestId: id,
    text: 'Поможешь перебраться на это окно?' }), { headers: { 'Content-Type': 'application/json' } }));
  const client = new ExternalAIProviderClient({ baseUrl: 'https://example.com', development: false,
    now: Date.now, fetch: fetcher, admitEventDispatch: requestId => controls.allowed() && helper.admitDispatch(requestId),
    eventDispatched: () => controls.dispatched() });
  events = new AIEventRuntime({ provider: client, now: Date.now, timestamp: () => new Date().toISOString(),
    createId: () => id, character: () => providerRequest().characterSnapshot, publish: vi.fn(),
    recall: { recall: async () => ({ ok: true, value: emptyMemoryContext() }) }, initiativeAllowed: () => controls.allowed(),
    windowHelp: { current: requestId => helper.current(requestId), published: requestId => helper.published(requestId), failed: requestId => helper.failed(requestId) },
    scheduler: { setTimeout, clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) },
    gate: () => ({ allowed: true, identity: 's', memoryGeneration: 0, activeRunId: null, localSpeech: false }) });
  helper = new WindowHelpRuntime({ now: Date.now, streamId: () => 's', createId: () => id,
    eligibility: () => ({ allowed: controls.allowed(), noCausalOverride: !causal, boredom, energy: 70 }),
    generation: () => 0, target: () => target(), budget, events: () => events, publish: vi.fn() });
  const choice = (): WindowHelpChoice => ({ decisionSequence: 1, generation: 0, selectedAtMs: Date.now(),
    reason: 'resolved_explore_needs_manual_support', target: target() });
  return { controls, helper, events, budget, fetcher, choice,
    causal: () => { causal = true; helper.tick(); events.tick(); }, boredom: (value: number) => { boredom = value; } };
}
it('sends one event and one shared budget token, then retains only the original previous phrase through accepted assist', async () => {
  const f = fixture();
  expect(f.helper.begin(f.choice())).toBe(false); expect(f.fetcher).not.toHaveBeenCalled();
  await f.controls.setConsent({ streamId: 's', profileGeneration: 0, enabled: true });
  expect(f.helper.begin(f.choice())).toBe(true); await flush();
  expect(f.fetcher).toHaveBeenCalledOnce(); expect(f.controls.status().requestsSent).toBe(1);
  expect(f.budget.getSnapshot().startedEpisodes).toBe(1); expect(f.helper.status().phase).toBe('waiting');
  const text = f.events.getSpeech()?.text; expect(text).toBeTruthy();
  expect(f.helper.acceptedDrag()).toBe(true); expect(f.events.getSpeech()).toBeNull();
  f.helper.acceptedRelease('window');
  expect(f.helper.status()).toMatchObject({ phase: 'closed', outcome: 'fulfilled' });
  expect(f.events.takePreviousInitiative()).toMatchObject({ kind: 'window_help', outcome: 'fulfilled', text });
  expect(f.fetcher).toHaveBeenCalledOnce(); f.events.dispose();
});
it('new causal state cancels pending source before dispatch, without budget spend or retry', async () => {
  const f = fixture(); await f.controls.setConsent({ streamId: 's', profileGeneration: 0, enabled: true });
  expect(f.helper.begin(f.choice())).toBe(true); f.causal(); await flush();
  expect(f.helper.status()).toMatchObject({ phase: 'closed', outcome: 'cancelled' });
  expect(f.fetcher).not.toHaveBeenCalled(); expect(f.budget.getSnapshot().startedEpisodes).toBe(0);
  expect(f.events.getSpeech()).toBeNull(); f.events.dispose();
});
