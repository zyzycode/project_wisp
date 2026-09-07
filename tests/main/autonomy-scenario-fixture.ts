import { vi } from 'vitest';
import { MainAutonomyComposition } from '../../src/main/main-autonomy-composition';
import { CharacterStateService } from '../../src/application/services/character-state.service';
import { CharacterInteractionUseCase } from '../../src/application/services/character-interaction.use-case';
import { ShimejiStimulusMapper } from '../../src/application/services/shimeji-stimulus.mapper';
import type { Needs } from '../../src/domain/character';
import type { ActivityOutcomeFeedback } from '../../src/application/ports/shimeji-feedback-port';
import type { ProviderBehaviorOffer } from '../../src/application/ports/behavior-admission-port';
export function scenario(needs: Partial<Needs> = {}, randomUnit = .2) {
  let now = 0; let id = 0; let nextTimer = 0; let root = { x: 400, y: 790 }; let target: typeof root | null = null;
  let movable = true; let supportValid = true; let random = randomUnit;
  const timers = new Map<number, { atMs: number; callback: () => void }>();
  const seed = new CharacterStateService({ now: () => 0 }).getState();
  const character = new CharacterStateService({ now: () => now, initialState: { ...seed,
    needs: { ...seed.needs, energy: 70, play: 80, boredom: 80, ...needs },
    relationship: { ...seed.relationship, friendship: 500, loveUnlocked: true } } });
  const input = new CharacterInteractionUseCase(character);
  const mapper = new ShimejiStimulusMapper(); const outcomes: ActivityOutcomeFeedback[] = [];
  const bounds = { id: 'screen', x: 0, y: 0, width: 1000, height: 800 };
  const environment = () => ({ capturedAtMs: now, screenBounds: bounds,
    currentSurface: { id: 'floor', kind: 'screen_floor' as const, bounds, isValidSupport: supportValid } });
  const move = vi.fn((command: { readonly targetRootPosition: typeof root; readonly speedPxPerSec: number }) => {
    if (!movable) return false; target = command.targetRootPosition; return true;
  });
  const main = new MainAutonomyComposition({ clock: { now: () => now }, scheduler: {
    setTimeout: (callback, delay) => { const key = ++nextTimer; timers.set(key, { callback, atMs: now + delay }); return key; },
    clearTimeout: key => { timers.delete(key as number); } },
    prng: { next: () => random }, prngMetadata: { algorithm: 'constant', seed: 1 },
    getCharacterSnapshot: () => ({ ...character.getSnapshot(), localTraits: { openness: .8, playfulness: .7, independence: .5, extraversion: .8 } }),
    tickNeeds: delta => { character.tickNeeds(delta, main.isSleepingForRecovery() ? 'sleepy' : undefined); },
    onActivityOutcome: event => { outcomes.push(event); const stimulus = mapper.map(event, {
      createdAtIso: new Date(now).toISOString(), landingThresholds: { stumbleMaxSeverity: 10 } });
      if (stimulus) character.applyStimulus(stimulus); },
    movement: { getRootPosition: () => root, getBounds: () => bounds, getEnvironmentSnapshot: environment,
      getCollisionInsets: () => ({ left: 10, right: 10, top: 80, bottom: 10 }),
      canAcceptVoluntaryMovement: () => movable, requestVoluntaryMovement: move,
      cancelVoluntaryMovement: () => { const had = target !== null; target = null; return had; } },
    requestManualRootPosition: () => false, createVisualEpisodeId: () => `visual-${++id}`,
    createActivityRunId: () => `run-${++id}`, onPresentationChanged: () => {},
  });
  main.start();
  const pulse = () => { const entry = [...timers.entries()].sort((a,b) => a[1].atMs - b[1].atMs)[0];
    if (!entry) return false; timers.delete(entry[0]); now = Math.max(now, entry[1].atMs); entry[1].callback(); return true; };
  const advance = (delta: number) => { now += delta; main.tick(); };
  const arrive = () => { if (target) { root = target; target = null; } main.notifyVoluntaryMovementCompleted(); };
  const finish = () => { for (let i = 0; i < 20; i++) { const t = main.getActivityTimeline(); if (!t) break;
    if (target) arrive(); else if (t.phaseEndsAtMs !== null) advance(Math.max(0, t.phaseEndsAtMs - now)); else break; } };
  const play = () => { main.suspendForUserInteraction(); input.execute({ type: 'play' });
    const accepted = main.handleCharacterInteraction('play'); main.resumeAfterUserInteraction(); return accepted; };
  const offer = (kind: ProviderBehaviorOffer['intent']['kind'], requestId = `request-${++id}`) => {
    main.setBehaviorContext({ requestId, conversationId: 'conversation', generation: 0, requestedAtMs: now });
    return main.offerDialogueIntent({ intent: { kind, source: 'provider', priority: 'normal', requestId },
      conversationId: 'conversation', generation: 0, requestedAtMs: now, receivedAtMs: now, expiresAtMs: now + 30000 }); };
  return { main, character, input, outcomes, timers, move, pulse, advance, arrive, finish, play, offer, environment,
    now: () => now, root: () => root, setRandom: (value: number) => { random = value; },
    setMovable: (value: boolean) => { movable = value; }, setSupportValid: (value: boolean) => { supportValid = value; } };
}
