import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { existsSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PetPresentationStateDTO, WispApiBridge } from '../../src/shared/ipc-contracts';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  completeCurrentState: vi.fn(() => true),
  synchronizeTerminalState: vi.fn(() => true),
  unsubscribePresentation: vi.fn(),
  onToggleSleep: undefined as (() => void) | undefined,
  isSleeping: false,
  animationState: 'idle',
  presentationListener: undefined as ((state: PetPresentationStateDTO) => void) | undefined,
  animationCompleted: undefined as ((_event: unknown, requestId: string | undefined) => void) | undefined,
  animationRejected: undefined as ((requestId: string | undefined) => void) | undefined,
}));

vi.mock('../../src/renderer/components/Character/CharacterRenderer', () => ({
  CharacterRenderer: (props: {
    readonly onAnimationCompleted?: (_event: unknown, requestId: string | undefined) => void;
    readonly onAnimationRejected?: (requestId: string | undefined) => void;
  }) => {
    mocks.animationCompleted = props.onAnimationCompleted;
    mocks.animationRejected = props.onAnimationRejected;
    return React.createElement('div', { 'data-testid': 'character' });
  },
}));
vi.mock('../../src/renderer/components/Interaction/ContextMenu', () => ({
  ContextMenu: (props: { readonly isSleeping: boolean; readonly onToggleSleep: () => void }) => {
    mocks.onToggleSleep = props.onToggleSleep;
    mocks.isSleeping = props.isSleeping;
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
  PetPresentationRevisionGate: class { accept() { return true; } },
  requestCharacterSleepWake: (
    api: Pick<WispApiBridge, 'requestSleepWake'>,
    action: 'sleep' | 'wake'
  ) => api.requestSleepWake({ action }),
  subscribeToPetPresentation: (api: WispApiBridge, listener: Parameters<WispApiBridge['onPetPresentationState']>[0]) =>
    api.onPetPresentationState(listener),
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

describe('Renderer: autonomy ownership', () => {
  const runtimeGlobals = globalThis as unknown as Record<string, unknown>;
  let previousWindow: unknown;
  let previousDocument: unknown;
  let testWindow: Record<string, unknown>;
  let testDocument: MiniDocument;

  beforeEach(() => {
    vi.useFakeTimers();
    mocks.animationState = 'idle';
    mocks.isSleeping = false;
    mocks.presentationListener = undefined;
    mocks.animationCompleted = undefined;
    mocks.animationRejected = undefined;
    mocks.completeCurrentState.mockReturnValue(true);
    mocks.synchronizeTerminalState.mockReturnValue(true);
    mocks.dispatch.mockReturnValue(true);
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
      requestAnimationFrame: (callback: (time: number) => void) => setTimeout(() => callback(performance.now()), 16),
      cancelAnimationFrame: clearTimeout,
    };
    testDocument.defaultView = testWindow;
    Object.assign(globalThis, { window: testWindow, document: testDocument, Node: MiniNode, HTMLElement: MiniNode });
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.assign(globalThis, { window: previousWindow, document: previousDocument });
  });

  it('mounts and unmounts with fake timers without creating a renderer autonomy loop', async () => {
    const api = {
      debugEnabled: false,
      onPetPresentationState: vi.fn((listener) => {
        mocks.presentationListener = listener;
        return mocks.unsubscribePresentation;
      }),
      getPosition: vi.fn(async () => ({ x: 300, y: 300 })),
      updatePosition: vi.fn(async (position) => position),
      setMenuExpanded: vi.fn(async () => ({ x: 300, y: 300 })),
      setAutonomyEnabled: vi.fn(async () => undefined),
      requestSleepWake: vi.fn(async () => undefined),
      notifyAnimationLifecycleResult: vi.fn(async () => undefined),
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
    expect(vi.getTimerCount()).toBe(1);
    mocks.dispatch.mockClear();
    await act(async () => mocks.onToggleSleep?.());
    expect(api.requestSleepWake).toHaveBeenCalledWith({ action: 'sleep' });
    expect(api.interactWithCharacter).not.toHaveBeenCalledWith({ type: 'sleep' });
    expect(mocks.dispatch).not.toHaveBeenCalledWith('START_SLEEP', true, true);

    mocks.animationState = 'sleep_start';
    await act(async () => mocks.presentationListener?.({
      revision: 1,
      motionPhase: 'grounded',
      rootScreenPosition: { x: 300, y: 300 },
      velocityPxPerSec: { x: 0, y: 0 },
      positionAuthority: 'voluntary',
      animationState: 'sleep_start',
      animationRequestId: 'animation-1',
    }));
    expect(mocks.dispatch).toHaveBeenCalledWith('START_SLEEP', true, false);
    mocks.dispatch.mockClear();
    await act(async () => mocks.animationCompleted?.({}, 'animation-1'));
    expect(mocks.completeCurrentState).toHaveBeenCalledOnce();
    expect(api.notifyAnimationLifecycleResult).toHaveBeenCalledWith({
      requestId: 'animation-1',
      outcome: 'completed',
    });
    await act(async () => mocks.presentationListener?.({
      revision: 2,
      motionPhase: 'grounded',
      rootScreenPosition: { x: 300, y: 300 },
      velocityPxPerSec: { x: 0, y: 0 },
      positionAuthority: 'voluntary',
      animationState: 'sleep_start',
      animationRequestId: 'animation-1',
    }));
    expect(mocks.dispatch).not.toHaveBeenCalled();
    expect(mocks.isSleeping).toBe(true);
    await act(async () => mocks.onToggleSleep?.());
    expect(api.requestSleepWake).toHaveBeenLastCalledWith({ action: 'wake' });

    mocks.animationState = 'sleep_loop';
    await act(async () => mocks.presentationListener?.({
      revision: 3,
      motionPhase: 'grounded',
      rootScreenPosition: { x: 300, y: 300 },
      velocityPxPerSec: { x: 0, y: 0 },
      positionAuthority: 'voluntary',
      animationState: 'sleep_loop',
    }));
    expect(mocks.isSleeping).toBe(true);
    await act(async () => mocks.onToggleSleep?.());
    expect(api.requestSleepWake).toHaveBeenLastCalledWith({ action: 'wake' });

    await act(async () => mocks.presentationListener?.({
      revision: 4,
      motionPhase: 'grounded',
      rootScreenPosition: { x: 300, y: 300 },
      velocityPxPerSec: { x: 0, y: 0 },
      positionAuthority: 'voluntary',
      animationState: 'wake_up',
      animationRequestId: 'animation-2',
    }));
    await act(async () => mocks.animationCompleted?.({}, 'animation-1'));
    expect(api.notifyAnimationLifecycleResult).not.toHaveBeenCalledWith({
      requestId: 'animation-2',
      outcome: 'completed',
    });
    await act(async () => mocks.presentationListener?.({
      revision: 5,
      motionPhase: 'airborne',
      rootScreenPosition: { x: 300, y: 290 },
      velocityPxPerSec: { x: 0, y: -100 },
      positionAuthority: 'forced',
      animationState: 'fall',
    }));
    expect(api.notifyAnimationLifecycleResult).toHaveBeenCalledWith({
      requestId: 'animation-2',
      outcome: 'interrupted',
    });

    await act(async () => mocks.presentationListener?.({
      revision: 6,
      motionPhase: 'grounded',
      rootScreenPosition: { x: 300, y: 300 },
      velocityPxPerSec: { x: 0, y: 0 },
      positionAuthority: 'voluntary',
      animationState: 'land',
      animationRequestId: 'animation-3',
    }));
    await act(async () => mocks.animationRejected?.('animation-3'));
    expect(api.notifyAnimationLifecycleResult).toHaveBeenCalledWith({
      requestId: 'animation-3',
      outcome: 'rejected',
    });
    await act(async () => mocks.presentationListener?.({
      revision: 7,
      motionPhase: 'grounded',
      rootScreenPosition: { x: 300, y: 300 },
      velocityPxPerSec: { x: 0, y: 0 },
      positionAuthority: 'voluntary',
      animationState: 'settle',
    }));
    expect(mocks.synchronizeTerminalState).toHaveBeenCalledWith('settle');

    await act(async () => mocks.presentationListener?.({
      revision: 8,
      motionPhase: 'grounded',
      rootScreenPosition: { x: 300, y: 300 },
      velocityPxPerSec: { x: 0, y: 0 },
      positionAuthority: 'voluntary',
      animationState: 'wake_up',
      animationRequestId: 'animation-4',
    }));
    await act(async () => mocks.presentationListener?.({
      revision: 9,
      motionPhase: 'grounded',
      rootScreenPosition: { x: 300, y: 300 },
      velocityPxPerSec: { x: 0, y: 0 },
      positionAuthority: 'voluntary',
      animationState: 'idle',
    }));
    expect(api.notifyAnimationLifecycleResult).toHaveBeenCalledWith({
      requestId: 'animation-4',
      outcome: 'interrupted',
    });
    expect(mocks.synchronizeTerminalState).toHaveBeenLastCalledWith('idle');
    const terminalSyncCount = mocks.synchronizeTerminalState.mock.calls.length;
    await act(async () => mocks.presentationListener?.({
      revision: 10,
      motionPhase: 'grounded',
      rootScreenPosition: { x: 300, y: 300 },
      velocityPxPerSec: { x: 0, y: 0 },
      positionAuthority: 'voluntary',
      animationState: 'idle',
    }));
    expect(mocks.synchronizeTerminalState).toHaveBeenCalledTimes(terminalSyncCount);

    await act(async () => vi.advanceTimersByTime(60_000));

    expect(api.getPosition).toHaveBeenCalledOnce();
    expect(api.updatePosition).not.toHaveBeenCalled();
    expect(api.setAutonomyEnabled).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);

    await act(async () => root.unmount());
    expect(mocks.unsubscribePresentation).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('removes the former autonomous hook module', () => {
    expect(existsSync(new URL('../../src/renderer/hooks/useAutonomousBehavior.ts', import.meta.url))).toBe(false);
  });
});
