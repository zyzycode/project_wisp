import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { causalStory, flushStory } from './causal-life-story-fixture';
import { DialogueRuntime } from '../../src/application/services/dialogue-loop.service';
import { CausalExpressionRuntime } from '../../src/application/services/causal-expression-runtime';
import { causalVisualExpression } from '../../src/domain/character/causal-director';
import { AssetResolver, ManifestLoader } from '../../src/renderer/render-engine';
import type { AIProviderRequest, AIProviderResponse, IAIProvider } from '../../src/application/ports/ai-provider.interface';
import type { DialogueRuntimeOptions } from '../../src/application/ports/dialogue-runtime';
import type { CompletedDialogueMemoryTurn } from '../../src/application/ports/memory-runtime';
import { DEFAULT_CHAT_CONTEXT_LIMITS } from '../../src/application/ports/memory-repository.interface';
const dirs: string[] = [];
const filename = () => { const dir = mkdtempSync(path.join(os.tmpdir(), 'wisp-causal-dialogue-')); dirs.push(dir); return path.join(dir, 'memory.sqlite3'); };
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function dialogue(f: ReturnType<typeof causalStory>, provider: IAIProvider, scope = 'story-message') {
  let id = 0;
  const director = new CausalExpressionRuntime({ now: f.now, read: () => ({ generation: f.currentGeneration(), owner: 'story-owner',
    activeRunId: f.main.getActivityTimeline()?.runId ?? null, consent: false, romanceAllowed: false,
    emotion: f.character.getCausalEmotion(), deferredInvitation: f.invite?.hasPendingInvitation() ?? false,
    ownGameInterest: f.character.getOwnGameInterest().band }) });
  const offerIntent = vi.fn<DialogueRuntimeOptions['offerIntent']>(), completed = vi.fn((turn: CompletedDialogueMemoryTurn) => f.history.completed(turn));
  const runtime = new DialogueRuntime({ provider, causalExpression: director, getSemanticSleepState: () => f.main.getSemanticSleepState(),
    now: f.now, timestamp: f.utc, createId: () => `${scope}-${++id}`, locale: 'en',
    scheduler: { setTimeout, clearTimeout: h => clearTimeout(h as ReturnType<typeof setTimeout>) },
    getCharacterSnapshot: () => f.character.getSnapshot(), applyStimulus: s => f.character.applyStimulus(s), offerIntent,
    beginThinking: id => f.main.beginDialogueThinking(id), endThinking: id => f.main.endDialogueThinking(id),
    onAcceptedUserInput: () => f.main.acceptDialogueContact(),
    memory: { generation: f.currentGeneration, completed, contextLimits: DEFAULT_CHAT_CONTEXT_LIMITS }, transaction: commit => commit(),
    publish: () => { f.main.observeDialoguePresentation(runtime.getPresentation()); } });
  runtime.replaceStream('story-stream');
  return { runtime, offerIntent, completed, send: () => runtime.receive({ type: 'send', text: 'What happened?',
    sequence: 1, streamId: 'story-stream', conversationId: runtime.getPresentation().conversationId }) };
}
const response = (r: AIProviderRequest, text: string): AIProviderResponse => ({ requestId: r.requestId, status: 'ok', confidence: 1,
  reply: { text, tone: 'playful' }, suggestedBehavior: 'play', suggestedMood: 'happy' });
it('two fake providers express the same actual interruption without changing local identity, evidence or opposite body meaning', async () => {
  const states = [], expressions = [];
  const manifest = new ManifestLoader().load(JSON.parse(readFileSync(path.resolve('public/assets/sprites/manifest.json'), 'utf8')));
  for (const text of ['Please give me a moment.', 'Let me settle first.']) {
    const f = causalStory(filename());
    let d: ReturnType<typeof dialogue> | undefined;
    try {
      f.elapse(300000); const event = await f.game(true, true);
      expect(event).toMatchObject({ outcome: 'cancelled', terminalReason: 'user_interaction', participation: 'user_engaged' });
      expect(f.command('recentCausalLife', 100)).toMatchObject({ ok: true, value: [{ cause: 'user_interrupted', source: 'user' }] });
      const before = f.character.getState(), requests: AIProviderRequest[] = [];
      d = dialogue(f, { getStatus: async () => ({ kind: 'ready' }), generateResponse: async r => { requests.push(r); return response(r, text); } });
      d.send(); await flushStory();
      expect(d.runtime.getPresentation().turn).toMatchObject({ phase: 'completed', replyText: text });
      expect(requests[0]?.causalExpression).toMatchObject({ cause: 'user_interrupted', emotion: 'irritated', intent: 'give_space' });
      expect(d.offerIntent).not.toHaveBeenCalled(); expect(d.completed).toHaveBeenCalledOnce();
      const after = f.character.getState();
      expect(after.relationship).toEqual(before.relationship); expect(after.preferences).toEqual(before.preferences);
      expect(after.personality).toEqual(before.personality);
      const expression = d.runtime.getCausalExpression();
      const visual = causalVisualExpression(f.main.getVisualEpisode().intent, expression, { forced: false, awake: true, priority: null });
      const resolved = new AssetResolver(manifest).resolve(visual);
      expect(resolved.body.animationKey).toBe('body_idle'); expect(resolved.face?.animationKey).toBe('face_pout');
      expect(resolved.props).toBeUndefined();
      expressions.push(expression); states.push({ relationship: after.relationship, personality: after.personality, preferences: after.preferences });
    } finally { d?.runtime.dispose(); await f.dispose(); }
  }
  expect(states[0]).toEqual(states[1]); expect(expressions[0]).toEqual(expressions[1]);
});
it('replaces the provider on the same Character and SQLite history while preserving canonical state and causal evidence', async () => {
  const f = causalStory(filename());
  let current: ReturnType<typeof dialogue> | undefined;
  try {
    f.elapse(300000); await f.game(true, true);
    const evidence = f.command('recentCausalLife', 100), identity = f.character.getState().personality;
    const states = [], expressions = [];
    for (const [index, text] of ['A moment, please.', 'I need a little space.'].entries()) {
      const before = f.character.getState(), requests: AIProviderRequest[] = [];
      current = dialogue(f, { getStatus: async () => ({ kind: 'ready' }), generateResponse: async r => { requests.push(r); return response(r, text); } }, `provider-${index}`);
      current.runtime.hydrateInitialContext(await f.history.hydrate());
      current.send(); await flushStory();
      expect(current.runtime.getPresentation().turn).toMatchObject({ phase: 'completed', replyText: text });
      if (index === 1) expect(requests[0]?.recentContext.some(message => message.text === 'A moment, please.')).toBe(true);
      const after = f.character.getState();
      expect(after.personality).toEqual(identity); expect(after.relationship).toEqual(before.relationship); expect(after.preferences).toEqual(before.preferences);
      expect(f.command('recentCausalLife', 100)).toEqual(evidence);
      states.push({ personality: after.personality, relationship: after.relationship, preferences: after.preferences });
      expressions.push(current.runtime.getCausalExpression()); current.runtime.dispose(); current = undefined;
    }
    expect(states[0]).toEqual(states[1]); expect(expressions[0]).toEqual(expressions[1]);
    expect((await f.history.hydrate()).map(message => message.text)).toEqual(['What happened?', 'A moment, please.', 'What happened?', 'I need a little space.']);
    f.reopen(); expect((await f.history.hydrate()).map(message => message.text)).toHaveLength(4);
  } finally { current?.runtime.dispose(); await f.dispose(); }
});
it('provider replacement alone retains the actual pending invitation; a later explicit user send cancels it by the existing contact rule', async () => {
  const f = causalStory(filename(), true);
  let current: ReturnType<typeof dialogue> | undefined;
  const provider: IAIProvider = { getStatus: async () => ({ kind: 'ready' }), generateResponse: async r => response(r, 'Current words') };
  try {
    f.elapse(300000); await f.game(true);
    const pending = f.command('readDeferredInvitation', f.utc()), state = f.character.getState();
    expect(pending).toMatchObject({ ok: true, value: { state: 'pending' } });
    current = dialogue(f, provider, 'first'); current.runtime.dispose();
    current = dialogue(f, provider, 'replacement');
    expect(f.character.getState()).toEqual(state); expect(f.command('readDeferredInvitation', f.utc())).toEqual(pending);
    current.send(); await flushStory();
    expect(f.command('readDeferredInvitation', f.utc())).toMatchObject({ ok: true, value: { state: 'cancelled' } });
    expect(current.runtime.getPresentation().turn.phase).toBe('completed');
  } finally { current?.runtime.dispose(); await f.dispose(); }
});
it('keeps the real offline cursor outcome/appraisal and uses a technical dialogue fallback without inference', async () => {
  const f = causalStory(filename(), false, false);
  let d: ReturnType<typeof dialogue> | undefined;
  try {
    f.elapse(300000); await f.game(true, true);
    expect(f.character.getCausalEmotion()?.cause).toBe('user_interrupted');
    expect(f.command('recentCausalLife', 100)).toEqual({ ok: true, value: [] });
    const generateResponse = vi.fn<IAIProvider['generateResponse']>();
    d = dialogue(f, { getStatus: async () => ({ kind: 'offline' }), generateResponse });
    d.send(); await flushStory();
    expect(d.runtime.getPresentation().turn).toMatchObject({ phase: 'completed', outcome: { kind: 'fallback' } });
    expect(generateResponse).not.toHaveBeenCalled(); expect(d.runtime.getCausalExpression()?.emotion).toBe('irritated');
    expect(f.character.getState().preferences['own.activity.cursor_game']).toBeUndefined();
  } finally { d?.runtime.dispose(); await f.dispose(); }
});
it('a reset while a real causal reply is pending removes source, local affect and every late reply/effect', async () => {
  const f = causalStory(filename());
  let d: ReturnType<typeof dialogue> | undefined;
  try {
    f.elapse(300000); await f.game(true, true);
    let request: AIProviderRequest | undefined, resolve: ((r: AIProviderResponse) => void) | undefined;
    d = dialogue(f, { getStatus: async () => ({ kind: 'ready' }), generateResponse: r => { request = r; return new Promise(done => { resolve = done; }); } });
    d.send(); await flushStory(); expect(request?.causalExpression).toBeDefined();
    f.reset(); const afterReset = f.character.getState();
    resolve?.(response(request!, 'Late words')); await flushStory();
    expect(d.runtime.getPresentation().turn.phase).toBe('idle'); expect(d.runtime.getCausalExpression()).toBeUndefined();
    expect(d.completed).not.toHaveBeenCalled(); expect(d.offerIntent).not.toHaveBeenCalled();
    expect(f.character.getState()).toEqual(afterReset); expect(f.command('recentCausalLife', 100)).toEqual({ ok: true, value: [] });
  } finally { d?.runtime.dispose(); await f.dispose(); }
});
