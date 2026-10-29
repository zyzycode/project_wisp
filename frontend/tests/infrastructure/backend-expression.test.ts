import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import type { BackendCharacterExpression } from '../../src/application/ports/backend-ai-contract';
import type { BackendCharacterContext } from '../../src/application/ports/backend-ai-contract';
import { canExpressFlirt } from '../../src/domain/character/intimacy-rules';
import { parseBackendExpression, projectBackendRequest } from '../../src/infrastructure/ai/backend-request-projection';
import { parseObservationRequest } from '../../src/infrastructure/ai/backend-observation-validation';
import { providerRequest } from './backend-ai-fixture';

const root = '../docs/contracts/fixtures/desktop-backend-v1';
const expression: BackendCharacterExpression = {
  romanceAllowed: false,
};

it('recomputes the next outgoing projection from current validated state without trusting stale cues', () => {
  const request = providerRequest();
  const source = request.characterSnapshot;
  source.needs = { ...source.needs, energy: 10, attention: 95, play: 95, comfort: 20 };
  source.relationship = { friendship: 700, love: 600, loveUnlocked: true };
  source.intimacy.userConsentEnabled = true;
  Object.assign(source, { expression: { ...expression, romanceAllowed: true } });
  const first = projectBackendRequest(request).character.expression;
  expect(first).toEqual({ romanceAllowed: false });
  source.needs = { ...source.needs, energy: 80, attention: 20, play: 20 };
  const second = projectBackendRequest(request).character.expression;
  expect(second).toEqual({ romanceAllowed: true });
  source.intimacy.userConsentEnabled = false;
  expect(projectBackendRequest(request).character.expression.romanceAllowed).toBe(false);
  expect(first.romanceAllowed).toBe(false); expect(second.romanceAllowed).toBe(true);
});

it('accepts only the one permission field without interpreting their numeric origin', () => {
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
      const character = value.character as BackendCharacterContext;
      expect(parseBackendExpression(character.expression)).toEqual({ romanceAllowed: canExpressFlirt(character) });
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
    expect(() => parseObservationRequest({ requestId: providerRequest().requestId, stream: false, locale: 'ru',
      character: entry.value.character, observation: { appName: 'Editor', windowTitle: '' } }), entry.name).toThrow();
  }
});

it('requires expression in observation wire input and preserves the declared permission', () => {
  const body = JSON.parse(readFileSync(join(root, 'observation/request.valid.json'), 'utf8')) as {
    character: Record<string, unknown>;
  };
  const declared = { romanceAllowed: true };
  expect(parseObservationRequest({ ...body, character: { ...body.character, expression: declared } }).character.expression)
    .toEqual(declared);
  const without = { ...body.character }; delete without.expression;
  expect(() => parseObservationRequest({ ...body, character: without })).toThrow();
  expect(() => parseObservationRequest({ ...body, character: { ...body.character, expression: null } })).toThrow();
});

it('sends raw facts and permission without duplicate tone or advisory bands', () => {
  const request = providerRequest();
  const character = projectBackendRequest(request).character;
  expect(character).not.toHaveProperty('synthesizedTone');
  expect(character.expression).toEqual({ romanceAllowed: false });
  expect(character.needs).toEqual(request.characterSnapshot.needs);
  expect(character.personality.traits).toEqual(request.characterSnapshot.personality.traits);
  expect(request.characterSnapshot).toHaveProperty('synthesizedTone');
});
