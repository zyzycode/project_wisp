import { expect, it } from 'vitest';
import { createMainAIProvider } from '../../src/main/main-ai-provider-composition';
import { MockAIProvider } from '../../src/infrastructure/ai/mock-ai-provider';
import { ExternalAIProviderClient } from '../../src/infrastructure/ai/external-ai-provider-client';

it('keeps unconfigured desktop on Mock without network configuration', () => {
  const composition = createMainAIProvider({ backendUrl: undefined, development: false, now: () => 0 });
  expect(composition.provider).toBeInstanceOf(MockAIProvider);
});
it('creates the configured adapter with a shared transport', () => {
  const composition = createMainAIProvider({ backendUrl: 'https://backend.example', development: false, now: () => 0 });
  expect(composition.provider).toBeInstanceOf(ExternalAIProviderClient);
});
it('fails invalid deployment configuration offline without crashing the local runtime', async () => {
  const composition = createMainAIProvider({ backendUrl: 'http://remote.example', development: false, now: () => 0 });
  await expect(composition.provider.getStatus()).resolves.toEqual({ kind: 'offline' });
});

it.each([false, true])('shares the unified transport with optional events/summary enabled=%s', enabled => {
  const c = createMainAIProvider({ backendUrl: 'https://backend.example', eventsEnabled: enabled, summaryEnabled: enabled, development: false, now: () => 0 });
  expect(c.interactionEnabled).toBe(true);
  expect(c.touchProvider).toBe(c.provider); expect(c.observationProvider).toBe(c.provider);
  expect(c.eventProvider).toBe(enabled ? c.provider : undefined);
  expect(c.summaryGenerator).toBe(enabled ? c.provider : undefined);
});
it.each([undefined, 'http://remote.example'])('does not expose network capabilities for unavailable configuration %s', backendUrl => {
  const c = createMainAIProvider({ backendUrl, eventsEnabled: true, summaryEnabled: true, development: false, now: () => 0 });
  expect(c.interactionEnabled).toBe(false);
  expect(c.touchProvider).toBeUndefined(); expect(c.eventProvider).toBeUndefined(); expect(c.summaryGenerator).toBeUndefined();
});
