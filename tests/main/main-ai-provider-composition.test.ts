import { expect, it } from 'vitest';
import { createMainAIProvider } from '../../src/main/main-ai-provider-composition';
import { MockAIProvider } from '../../src/infrastructure/ai/mock-ai-provider';
import { ExternalAIProviderClient } from '../../src/infrastructure/ai/external-ai-provider-client';

it('keeps unconfigured desktop on Mock with no paid admission counters', () => {
  const composition = createMainAIProvider({ backendUrl: undefined, development: false, now: () => 0 });
  expect(composition.provider).toBeInstanceOf(MockAIProvider); expect(composition.requestControl).toBeUndefined();
});
it('creates the configured adapter with the same Main-lifetime request control', () => {
  const composition = createMainAIProvider({ backendUrl: 'https://backend.example', development: false, now: () => 0 });
  expect(composition.provider).toBeInstanceOf(ExternalAIProviderClient); expect(composition.requestControl?.availability(0)).toEqual({ available: true });
});
it('fails invalid deployment configuration offline without crashing the local runtime', async () => {
  const composition = createMainAIProvider({ backendUrl: 'http://remote.example', development: false, now: () => 0 });
  await expect(composition.provider.getStatus()).resolves.toEqual({ kind: 'offline' });
});

it('rejects unknown API versions without silently sending v1', async () => {
  const composition = createMainAIProvider({ backendUrl: 'https://backend.example', backendApiVersion: '4', development: false, now: () => 0 });
  expect(await composition.provider.getStatus()).toEqual({ kind: 'offline' });
});

it('exposes event provider only for explicitly enabled v3 and shares its control with user chat', () => {
  for (const backendApiVersion of [undefined, '1', '2', '3']) for (const eventsEnabled of [false, true]) {
    const c = createMainAIProvider({ backendUrl: 'https://backend.example', backendApiVersion, eventsEnabled, development: false, now: () => 1000 });
    if (backendApiVersion === '3' && eventsEnabled) { expect(c.eventProvider).toBe(c.provider); expect(c.eventControl).toBe(c.requestControl); expect(c.eventControl?.eventAvailability(300999).available).toBe(false); }
    else expect(c.eventProvider).toBeUndefined();
  }
});
