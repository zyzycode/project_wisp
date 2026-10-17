import { vi } from 'vitest';
import type { ActiveApplicationObservationSnapshot, ObservationPolicy } from '../../src/application/ports/active-application-observation.port';
import type { IObservationProvider } from '../../src/application/ports/observation-provider.interface';
import { ObservationRuntime } from '../../src/application/services/observation-runtime';
import { providerRequest } from '../infrastructure/backend-ai-fixture';
export const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
export function observationFixture(withProvider = true) {
  let policy: ObservationPolicy = { generation: 0, active: false, applications: [] }, revision = 0;
  let snapshot: ActiveApplicationObservationSnapshot = { policyGeneration: 0, revision: 0, capturedAtMs: 0, capability: 'unavailable', reason: 'disabled' };
  let listener: (snapshot: ActiveApplicationObservationSnapshot) => void = () => undefined;
  const gate = { identity: 'stream:c:0' as string | null, allowed: true, busy: false, higherSpeech: false };
  const observer = { getSnapshot: () => snapshot, subscribe: (next: typeof listener) => { listener = next; return vi.fn(); },
    replacePolicy: vi.fn((next: ObservationPolicy) => { policy = next; }), pause: vi.fn(), dispose: vi.fn() };
  const generateObservation = vi.fn<IObservationProvider['generateObservation']>(async () => 'Может, сделать паузу?');
  const canStartObservation = vi.fn(() => true);
  const spendBudget = vi.fn(() => true), publish = vi.fn();
  const runtime = new ObservationRuntime({ observer, ...(withProvider ? { provider: { generateObservation, canStartObservation } } : {}), now: Date.now, createId: () => providerRequest().requestId,
    scheduler: { setTimeout, clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) }, character: () => providerRequest().characterSnapshot,
    gate: () => gate, spendBudget, publish });
  runtime.addApplication({ appKey: 'app', alias: 'Alias', category: 'other', excluded: false });
  function sample(token = 'source', episode = 'episode', overrides: Partial<Extract<ActiveApplicationObservationSnapshot, { capability: 'available' }>> = {}) {
    snapshot = { policyGeneration: policy.generation, revision: ++revision, capturedAtMs: Date.now(), capability: 'available', appKey: 'app', episodeToken: episode,
      sourceToken: token, appName: 'Code', windowTitle: 'Synthetic title', category: 'other', ...overrides }; listener(snapshot);
  }
  async function dwell(token = 'source', episode = 'episode', seconds = 30) { sample(token, episode); for (let i = 0; i < seconds; i++) { await vi.advanceTimersByTimeAsync(1000); sample(token, episode); } await flush(); }
  function unavailable(reason: 'paused' | 'bridge_failed' | 'excluded' | 'unsupported' = 'excluded') { snapshot = { policyGeneration: policy.generation, revision: ++revision, capturedAtMs: Date.now(), capability: 'unavailable', reason }; listener(snapshot); }
  return { runtime, sample, dwell, unavailable, generateObservation, canStartObservation, spendBudget, publish, observer, gate, policy: () => policy };
}
