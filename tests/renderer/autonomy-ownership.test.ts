import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { existsSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrainStateDTO, WispApiBridge } from '../../src/shared/ipc-contracts';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(() => true),
  completeCurrentState: vi.fn(() => true),
  synchronizeTerminalState: vi.fn(() => true),
  unsubscribeBrain: vi.fn(),
  onToggleSleep: undefined as (() => void) | undefined,
  brainListener: undefined as ((state: BrainStateDTO) => void) | undefined,
  animationCompleted: undefined as ((_event: unknown, episodeId: string | undefined) => void) | undefined,
  animationRejected: undefined as ((episodeId: string | undefined) => void) | undefined,
  animationState: 'idle',
  visualAgeMs: undefined as number | undefined,
}));

vi.mock('../../src/renderer/components/Character/CharacterRenderer', () => ({
  CharacterRenderer: (props: {
    readonly onAnimationCompleted?: (_event: unknown, episodeId: string | undefined) => void;
    readonly onAnimationRejected?: (episodeId: string | undefined) => void;
    readonly visualAgeMs?: number;
  }) => {
    mocks.animationCompleted = props.onAnimationCompleted;
    mocks.animationRejected = props.onAnimationRejected;
    mocks.visualAgeMs = props.visualAgeMs;
    return React.createElement('div', { 'data-testid': 'character' });
  },
}));
vi.mock('../../src/renderer/components/Interaction/ContextMenu', () => ({
  ContextMenu: (props: { readonly onToggleSleep: () => void }) => {
    mocks.onToggleSleep = props.onToggleSleep;
    return null;
  },
}));
vi.mock('../../src/renderer/components/Chat/SpeechBubble', () => ({ SpeechBubble: () => null }));
vi.mock('../../src/renderer/components/Chat/ChatInput', () => ({ ChatInput: () => null }));
vi.mock('../../src/renderer/components/Debug', () => ({ DebugHUD: () => null }));
vi.mock('../../src/renderer/hooks/useAnimationStateMachine', () => ({
  useAnimationStateMachine: () => ({
    state: mocks.animationState,
    expression: 'idle',
    dispatch: mocks.dispatch,
    completeCurrentState: mocks.completeCurrentState,
    synchronizeTerminalState: mocks.synchronizeTerminalState,
  }),
}));
vi.mock('../../src/renderer/hooks/useDialogueLoop', () => ({
  useDialogueLoop: () => ({ handleSendMessage: vi.fn() }),
}));
vi.mock('../../src/renderer/pet-main-bridge', () => ({
  PetDragController: class {},
  BrainStateRevisionGate: class { public accept(state: BrainStateDTO) { return state; } },
  requestCharacterSleepWake: (
    api: Pick<WispApiBridge, 'requestSleepWake'>,
    action: 'sleep' | 'wake'
  ) => api.requestSleepWake({ action }),
  subscribeToBrainState: (
    api: WispApiBridge,
    listener: Parameters<WispApiBridge['onBrainState']>[0]
  ) => api.onBrainState(listener),
  toAnimationIntent: (visual: BrainStateDTO['visualIntent']) => ({
    ...visual,
    requestedBy: 'brain',
  }),
}));

class MiniNode {
  public readonly childNodes: MiniNode[] = [];
  public parentNode: MiniNode | null = null;
  public ownerDocument: MiniDocument;
  public readonly style: Record<string, string> = {};
  public textContent = '';
  public nodeValue: string | null = null;
  public namespaceURI = 'http://www.w3.org/1999/xhtml';
  public readonly attributes = new Map<string, string>();

  public constructor(
    public readonly nodeType: number,
    public readonly nodeName: string,
    ownerDocument?: MiniDocument
  ) {
    this.ownerDocument = ownerDocument ?? (this as unknown as MiniDocument);
  }

  public get tagName(): string { return this.nodeName; }
  public get firstChild(): MiniNode | null { return this.childNodes[0] ?? null; }
  public get lastChild(): MiniNode | null { return this.childNodes.at(-1) ?? null; }
  public appendChild(child: MiniNode): MiniNode {
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }
  public insertBefore(child: MiniNode, before: MiniNode | null): MiniNode {
    child.parentNode = this;
    const index = before === null ? -1 : this.childNodes.indexOf(before);
    if (index < 0) this.childNodes.push(child);
    else this.childNodes.splice(index, 0, child);
    return child;
  }
  public removeChild(child: MiniNode): MiniNode {
    const index = this.childNodes.indexOf(child);
    if (index >= 0) this.childNodes.splice(index, 1);
    child.parentNode = null;
    return child;
  }
  public setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  public removeAttribute(name: string): void { this.attributes.delete(name); }
  public addEventListener(): void {}
  public removeEventListener(): void {}
}

class MiniDocument extends MiniNode {
  public readonly documentElement: MiniNode;
  public readonly body: MiniNode;
  public activeElement: MiniNode | null = null;
  public defaultView: Record<string, unknown> | null = null;

  public constructor() {
    super(9, '#document');
    this.documentElement = this.createElement('html');
    this.body = this.createElement('body');
    this.documentElement.appendChild(this.body);
    this.appendChild(this.documentElement);
  }
  public createElement(tag: string): MiniNode { return new MiniNode(1, tag.toUpperCase(), this); }
  public createElementNS(_namespace: string, tag: string): MiniNode { return this.createElement(tag); }
  public createTextNode(text: string): MiniNode {
    const node = new MiniNode(3, '#text', this);
    node.nodeValue = text;
    return node;
  }
  public createComment(text: string): MiniNode {
    const node = new MiniNode(8, '#comment', this);
    node.nodeValue = text;
    return node;
  }
}

function brainState(
  revision: number,
  episodeId: string,
  kind: BrainStateDTO['visualIntent']['kind'],
  phase: BrainStateDTO['motion']['phase'] = 'grounded'
): BrainStateDTO {
  return {
    streamId: 'stream-1',
    revision,
    sampledAtMs: revision * 10,
    character: {
      needs: { energy: 80, attention: 30, play: 40, comfort: 50, boredom: 10 },
      synthesizedTone: 'neutral',
    },
    activity: null,
    motion: {
      phase,
      rootScreenPosition: { x: 300, y: phase === 'airborne' ? 290 : 300 },
      velocityPxPerSec: { x: 0, y: phase === 'airborne' ? -100 : 0 },
      positionAuthority: phase === 'grounded' ? 'voluntary' : 'forced',
    },
    visualIntent: {
      episodeId,
      episodeStartedAtMs: revision * 10,
      kind,
      category: kind === 'sleep_start' ? 'sleep' : kind === 'fall' ? 'movement' : 'transition',
      priority: 'high',
      interrupt: 'limited',
      loop: kind === 'fall' ? 'until_replaced' : 'none',
      emotionalTone: 'neutral',
    },
  };
}

describe('Renderer: autonomy ownership', () => {
  const runtimeGlobals = globalThis as unknown as Record<string, unknown>;
  let previousWindow: unknown;
  let previousDocument: unknown;
  let testWindow: Record<string, unknown>;
  let testDocument: MiniDocument;

  beforeEach(() => {
    vi.useFakeTimers();
    mocks.animationState = 'idle';
    mocks.brainListener = undefined;
    mocks.animationCompleted = undefined;
    mocks.animationRejected = undefined;
    mocks.dispatch.mockClear();
    mocks.completeCurrentState.mockClear();
    mocks.synchronizeTerminalState.mockClear();
    mocks.unsubscribeBrain.mockClear();
    previousWindow = runtimeGlobals.window;
    previousDocument = runtimeGlobals.document;
    testDocument = new MiniDocument();
    testWindow = {
      document: testDocument,
      event: undefined,
      Node: MiniNode,
      HTMLElement: MiniNode,
      HTMLIFrameElement: class {},
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      getSelection: () => null,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      requestAnimationFrame: (callback: (time: number) => void) =>
        setTimeout(() => callback(performance.now()), 16),
      cancelAnimationFrame: clearTimeout,
    };
    testDocument.defaultView = testWindow;
    Object.assign(globalThis, {
      window: testWindow,
      document: testDocument,
      Node: MiniNode,
      HTMLElement: MiniNode,
      IS_REACT_ACT_ENVIRONMENT: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.assign(globalThis, { window: previousWindow, document: previousDocument });
  });

  it('consumes Brain episodes without Renderer lifecycle feedback or autonomy cadence', async () => {
    const api = {
      debugEnabled: false,
      onBrainState: vi.fn((listener: (state: BrainStateDTO) => void) => {
        mocks.brainListener = listener;
        return mocks.unsubscribeBrain;
      }),
      postBodyEvent: vi.fn(async () => undefined),
      getPosition: vi.fn(async () => ({ x: 300, y: 300 })),
      updatePosition: vi.fn(async (position) => position),
      setMenuExpanded: vi.fn(async () => ({ x: 300, y: 300 })),
      setAutonomyEnabled: vi.fn(async () => undefined),
      requestSleepWake: vi.fn(async () => undefined),
      interactWithCharacter: vi.fn(async () => undefined),
    } as unknown as WispApiBridge;
    Object.assign(testWindow, { wispAPI: api });
    const desktopPetPath = '../../src/renderer/components/DesktopPet';
    const { DesktopPet } = await import(desktopPetPath) as {
      DesktopPet: React.ComponentType;
    };
    const container = testDocument.createElement('div') as unknown as Parameters<typeof createRoot>[0];
    const root = createRoot(container);

    await act(async () => root.render(React.createElement(DesktopPet)));
    await act(async () => mocks.onToggleSleep?.());
    expect(api.requestSleepWake).toHaveBeenCalledWith({ action: 'sleep' });
    expect(mocks.dispatch).not.toHaveBeenCalledWith('START_SLEEP', true, true);

    const sleeping = brainState(1, 'episode-1', 'sleep_start');
    await act(async () => mocks.brainListener?.({
      ...sleeping,
      visualIntent: { ...sleeping.visualIntent, episodeStartedAtMs: 2 },
    }));
    expect(mocks.dispatch).toHaveBeenCalledWith('START_SLEEP', true, false);
    expect(mocks.visualAgeMs).toBe(8);
    mocks.dispatch.mockClear();
    const sleepingUpdate = brainState(2, 'episode-1', 'sleep_start');
    await act(async () => mocks.brainListener?.({
      ...sleepingUpdate,
      visualIntent: { ...sleepingUpdate.visualIntent, episodeStartedAtMs: 2 },
    }));
    expect(mocks.dispatch).not.toHaveBeenCalled();

    await act(async () => mocks.animationCompleted?.({}, 'episode-1'));
    expect(mocks.completeCurrentState).toHaveBeenCalledOnce();
    expect(api.postBodyEvent).not.toHaveBeenCalled();

    await act(async () => mocks.brainListener?.(brainState(3, 'episode-2', 'wake_up')));
    expect(mocks.dispatch).toHaveBeenCalledWith('WAKE_UP', true, false);
    const completedCount = mocks.completeCurrentState.mock.calls.length;
    await act(async () => mocks.animationCompleted?.({}, 'episode-1'));
    expect(mocks.completeCurrentState).toHaveBeenCalledTimes(completedCount);

    await act(async () => mocks.brainListener?.(brainState(4, 'episode-3', 'fall', 'airborne')));
    expect(mocks.dispatch).toHaveBeenCalledWith('FALL', true, false);
    await act(async () => mocks.brainListener?.(brainState(5, 'episode-4', 'land')));
    expect(mocks.dispatch).toHaveBeenCalledWith('LAND', true, false);
    await act(async () => mocks.animationRejected?.('episode-4'));
    expect(api.postBodyEvent).not.toHaveBeenCalled();

    await act(async () => vi.advanceTimersByTime(60_000));
    expect(api.getPosition).toHaveBeenCalledOnce();
    expect(api.updatePosition).not.toHaveBeenCalled();
    expect(api.setAutonomyEnabled).not.toHaveBeenCalled();

    await act(async () => root.unmount());
    expect(mocks.unsubscribeBrain).toHaveBeenCalledOnce();
    expect(api.postBodyEvent).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('removes the former autonomous hook module', () => {
    expect(existsSync(new URL('../../src/renderer/hooks/useAutonomousBehavior.ts', import.meta.url))).toBe(false);
  });
});
