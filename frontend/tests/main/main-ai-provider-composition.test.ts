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

it('rejects unknown API versions without silently sending v1', async () => {
  const composition = createMainAIProvider({ backendUrl: 'https://backend.example', backendApiVersion: '4', development: false, now: () => 0 });
  expect(await composition.provider.getStatus()).toEqual({ kind: 'offline' });
});

it('exposes event provider only for explicitly enabled v3 and shares its transport with user chat', () => {
  for (const backendApiVersion of [undefined, '1', '2', '3']) for (const eventsEnabled of [false, true]) {
    const c = createMainAIProvider({ backendUrl: 'https://backend.example', backendApiVersion, eventsEnabled, development: false, now: () => 1000 });
    if (backendApiVersion === '3' && eventsEnabled) { expect(c.eventProvider).toBe(c.provider); }
    else expect(c.eventProvider).toBeUndefined();
  }
});

it('enables summary only for explicit v5 plus flag, retaining v3 events on that same adapter', () => {
  for (const backendApiVersion of [undefined, '1', '2', '3', '5']) for (const summaryEnabled of [false, true]) {
    const c = createMainAIProvider({ backendUrl: 'https://backend.example', backendApiVersion, summaryEnabled, eventsEnabled: true, development: false, now: () => 1000 });
    if (backendApiVersion === '5' && summaryEnabled) expect(c.summaryGenerator).toBe(c.provider);
    else expect(c.summaryGenerator).toBeUndefined();
    if (backendApiVersion === '5') expect(c.eventProvider).toBe(c.provider);
  }
  expect(createMainAIProvider({ backendUrl: undefined, backendApiVersion: '5', summaryEnabled: true, development: false, now: () => 0 }).summaryGenerator).toBeUndefined();
});


it('exposes interactions only for valid explicit v7 and retains optional shared capabilities', async () => {
  for (const backendApiVersion of [undefined, '1', '2', '3', '5', '7', 'invalid']) {
    const c = createMainAIProvider({ backendUrl: 'https://backend.example', backendApiVersion, summaryEnabled: true, eventsEnabled: true, development: false, now: () => 0 });
    expect(c.interactionEnabled).toBe(backendApiVersion === '7');
    if (backendApiVersion === '7') {
      expect(c.touchProvider).toBe(c.provider); expect(c.eventProvider).toBe(c.provider);
      expect(c.summaryGenerator).toBe(c.provider); expect(c.observationProvider).toBe(c.provider);
    }
  }
  for (const backendUrl of [undefined, 'http://remote.example']) {
    const c = createMainAIProvider({ backendUrl, backendApiVersion: '7', development: false, now: () => 0 });
    expect(c.interactionEnabled).toBe(false);
  }
  const c = createMainAIProvider({ backendUrl: 'https://backend.example', backendApiVersion: '7', development: false, now: () => 0 });
  expect(c.interactionEnabled).toBe(true); expect(c.touchProvider).toBe(c.provider);
  expect(c.eventProvider).toBeUndefined(); expect(c.summaryGenerator).toBeUndefined();
});
