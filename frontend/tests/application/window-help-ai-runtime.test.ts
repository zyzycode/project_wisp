import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AIEventRuntime } from '../../src/application/services/ai-event-runtime';
import { emptyMemoryContext } from '../../src/application/services/memory-recall';
import { providerRequest } from '../infrastructure/backend-ai-fixture';
import type { IAIEventProvider } from '../../src/application/ports/ai-event-provider.interface';
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(10000); });
afterEach(() => vi.useRealTimers());
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function fixture() {
  let enabled = true, current = true, causal = false;
  const published = vi.fn(() => true), failed = vi.fn(), cancel = vi.fn();
  const generateEvent = vi.fn<IAIEventProvider['generateEvent']>(async request => ({ requestId: request.requestId, replyText: 'Поможешь?' }));
  const runtime = new AIEventRuntime({ provider: { generateEvent, cancel }, now: Date.now,
    timestamp: () => new Date().toISOString(), createId: () => 'http-request',
    scheduler: { setTimeout, clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) },
    character: () => providerRequest().characterSnapshot, publish: vi.fn(),
    recall: { recall: async () => ({ ok: true, value: emptyMemoryContext() }) },
    initiativeAllowed: () => enabled,
    causalExpression: { capture: requestId => causal ? { requestId, sourceSequence: 1, signature: 's',
      deadlineMs: Date.now() + 1000, expression: { activity: 'cursor_game', intent: 'acknowledge',
        emotion: 'content', intensity: 'low', target: 'self', cause: 'completed',
        deferredInvitation: false, ownActivityInterest: 'none' }, voiceProsody: 'neutral' } : undefined,
      isCurrent: () => true },
    windowHelp: { current: () => current, published, failed },
    gate: () => ({ allowed: true, identity: 'profile', memoryGeneration: 0, activeRunId: null, localSpeech: false }) });
  return { runtime, generateEvent, cancel, published, failed,
    revoke: () => { enabled = false; runtime.invalidate(); }, lost: () => { current = false; runtime.tick(); },
    causal: () => { causal = true; runtime.tick(); } };
}
it('publishes only text for a current manual source and updates outcome without resurrecting consumed previous slot', async () => {
  const f = fixture();
  expect(f.runtime.windowHelpStarted('help', 'upper_center')).toBe(true); await flush();
  expect(f.published).toHaveBeenCalledExactlyOnceWith('help');
  expect(f.generateEvent.mock.calls[0]![0].event).toMatchObject({ type: 'window_help_requested', targetRegion: 'upper_center' });
  f.runtime.assistContact(); f.runtime.updateWindowHelpOutcome('assisting');
  f.runtime.updateWindowHelpOutcome('fulfilled');
  expect(f.runtime.takePreviousInitiative()).toMatchObject({ kind: 'window_help', outcome: 'fulfilled', text: 'Поможешь?' });
  f.runtime.updateWindowHelpOutcome('cancelled');
  expect(f.runtime.takePreviousInitiative()).toBeUndefined(); f.runtime.dispose();
});
it.each(['revoke', 'lost', 'causal'] as const)('aborts pending help after %s and rejects late output', async action => {
  const f = fixture();
  let resolve!: (result: { requestId: string; replyText: string }) => void;
  f.generateEvent.mockImplementation(() => new Promise(yes => { resolve = yes; }));
  f.runtime.windowHelpStarted('help', 'upper_center'); await flush(); f[action]();
  resolve({ requestId: 'help', replyText: 'Поздний ответ' }); await flush();
  expect(f.runtime.getSpeech()).toBeNull(); expect(f.published).not.toHaveBeenCalled();
  expect(f.runtime.takePreviousInitiative()).toBeUndefined(); f.runtime.dispose();
});
