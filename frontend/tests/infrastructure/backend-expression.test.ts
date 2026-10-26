import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import type { BackendCharacterExpression } from '../../src/application/ports/backend-ai-contract';
import type { CharacterSnapshot } from '../../src/domain/character/types';
import { projectCharacterExpression } from '../../src/domain/character/character-snapshot';
import { parseBackendExpression, projectBackendRequest } from '../../src/infrastructure/ai/backend-request-projection';
import { parseObservationRequest } from '../../src/infrastructure/ai/backend-observation-validation';
import { providerRequest } from './backend-ai-fixture';

const root = '../docs/contracts/fixtures/desktop-backend-v1';
const expression: BackendCharacterExpression = {
  pace: 'normal', trust: 'familiar', attention: 'ordinary', play: 'ordinary', romanceAllowed: false,
};

it('recomputes the next outgoing projection from current validated state without trusting stale cues', () => {
  const request = providerRequest();
  const source = request.characterSnapshot;
  source.needs = { ...source.needs, energy: 10, attention: 95, play: 95, comfort: 20 };
  source.relationship = { friendship: 700, love: 600, loveUnlocked: true };
  source.intimacy.userConsentEnabled = true;
  Object.assign(source, { expression: { ...expression, romanceAllowed: true } });
  const first = projectBackendRequest(request).character.expression;
  expect(first).toEqual({ pace: 'gentle', trust: 'close', attention: 'high', play: 'high', romanceAllowed: false });
  source.needs = { ...source.needs, energy: 80, attention: 20, play: 20 };
  const second = projectBackendRequest(request).character.expression;
  expect(second).toEqual({ pace: 'normal', trust: 'close', attention: 'ordinary', play: 'ordinary', romanceAllowed: true });
  source.intimacy.userConsentEnabled = false;
  expect(projectBackendRequest(request).character.expression.romanceAllowed).toBe(false);
  expect(first.romanceAllowed).toBe(false); expect(second.romanceAllowed).toBe(true);
});

it('accepts only the five independent wire fields without interpreting their numeric origin', () => {
  expect(parseBackendExpression(expression)).toEqual(expression);
  for (const key of Object.keys(expression)) {
    const incomplete: Record<string, unknown> = { ...expression }; delete incomplete[key];
    expect(() => parseBackendExpression(incomplete)).toThrow();
  }
});

function fixturePaths(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? fixturePaths(join(directory, entry.name))
    : entry.name.endsWith('.json') && entry.name !== 'invalid.json' ? [join(directory, entry.name)] : []);
}

it('agrees with every valid character projection in the shared wire corpus', () => {
  let checked = 0;
  function visit(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    if ('character' in value && value.character && typeof value.character === 'object') {
      const character = value.character as CharacterSnapshot & { readonly expression: unknown };
      expect(parseBackendExpression(character.expression)).toEqual(projectCharacterExpression(character));
      checked += 1;
    }
    for (const child of Object.values(value)) visit(child);
  }
  for (const file of fixturePaths(root)) visit(JSON.parse(readFileSync(file, 'utf8')));
  expect(checked).toBeGreaterThan(10);
});

it('rejects the shared malformed expression corpus at the strict desktop wire guard', () => {
  const corpus = JSON.parse(readFileSync(join(root, 'expression/invalid.json'), 'utf8')) as {
    readonly requests: readonly { readonly name: string; readonly value: { readonly character: { readonly expression?: unknown } } }[];
  };
  expect(corpus.requests.length).toBeGreaterThan(0);
  for (const entry of corpus.requests) {
    expect(() => parseBackendExpression(entry.value.character.expression), entry.name).toThrow();
  }
});

it('requires expression in observation wire input and preserves valid declared bands', () => {
  const body = JSON.parse(readFileSync(join(root, 'observation/request.valid.json'), 'utf8')) as {
    character: Record<string, unknown>;
  };
  const declared = { ...expression, pace: 'normal' as const };
  expect(parseObservationRequest({ ...body, character: { ...body.character, expression: declared } }).character.expression)
    .toEqual(declared);
  const without = { ...body.character }; delete without.expression;
  expect(() => parseObservationRequest({ ...body, character: without })).toThrow();
  expect(() => parseObservationRequest({ ...body, character: { ...body.character, expression: null } })).toThrow();
});
