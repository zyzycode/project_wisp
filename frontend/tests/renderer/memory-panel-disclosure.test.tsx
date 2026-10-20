import { Children, isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { SummaryControls } from '../../src/renderer/components/Chat/SummaryControls';
import { getSummaryClient } from '../../src/renderer/summary-client';
import { MemoryCards } from '../../src/renderer/components/Chat/MemoryCards';
import type { MemoryCardListResultDTO, MemoryCardResultDTO } from '../../src/shared/ipc-contracts';

const hooks = vi.hoisted(() => ({ values: [] as unknown[], index: 0, effects: [] as (() => void)[] }));
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState: <T,>(initial: T) => {
    const index = hooks.index++;
    if (!(index in hooks.values)) hooks.values[index] = initial;
    return [hooks.values[index], (value: T) => { hooks.values[index] = value; }];
  },
  useEffect: (effect: () => void) => { hooks.effects.push(effect); },
  useId: () => 'memory-panel',
  useSyncExternalStore: (_subscribe: unknown, getState: () => unknown) => getState(),
}));
beforeEach(() => { hooks.values = []; hooks.index = 0; hooks.effects = []; });
function fixture(completed = false) {
  const bridge = {
    listMemoryCards: vi.fn(async (): Promise<MemoryCardListResultDTO> => ({ ok: true, generation: 0, items: [], nextCursor: null })),
    mutateMemoryCard: vi.fn(async (): Promise<MemoryCardResultDTO> => ({ ok: false, generation: 0, code: 'unavailable' })),
    summary: { preview: vi.fn(), confirm: vi.fn(), deleteSummary: vi.fn() },
  };
  const snapshot = { streamId: 's', dialogue: { conversationId: 'c', canSubmit: true, turn: completed ? { phase: 'completed' as const, requestId: 'r', replyText: 'Ответ', outcome: { kind: 'success' as const }, memorySource: { userMessageId: 'u', assistantMessageId: 'a' } } : { phase: 'idle' as const } } };
  const render = () => { hooks.index = 0; return MemoryCards({ bridge, snapshot }); };
  return { bridge, render };
}
function click(node: ReactNode, label: string): void {
  let clicked = false;
  function visit(children: ReactNode): void {
    Children.forEach(children, child => {
      if (!isValidElement<{ children?: ReactNode; onClick?: () => void }>(child)) return;
      if (child.type === 'button' && child.props.children === label) { child.props.onClick?.(); clicked = true; }
      else visit(child.props.children);
    });
  }
  visit(node); expect(clicked).toBe(true);
}
it('keeps memory actions out of the initial chat and discloses them only on request', () => {
  const { bridge, render } = fixture();
  let tree = render();
  expect(renderToStaticMarkup(tree)).not.toContain('Составить краткое содержание');
  expect(renderToStaticMarkup(tree)).toContain('aria-expanded="false"');
  click(tree, 'Память'); tree = render();
  expect(renderToStaticMarkup(tree)).toContain('aria-expanded="true"');
  expect(renderToStaticMarkup(tree)).toContain('Составить краткое содержание');
  expect(renderToStaticMarkup(tree)).toContain('завершённого ответа');
  click(tree, 'Память'); tree = render();
  expect(renderToStaticMarkup(tree)).not.toContain('Составить краткое содержание');
  click(tree, 'Память'); tree = render();
  expect(renderToStaticMarkup(tree)).toContain('Обновить список');
  expect(bridge.mutateMemoryCard).not.toHaveBeenCalled();
  expect(bridge.summary.confirm).not.toHaveBeenCalled();
});

it('preserves an unconfirmed draft when memory is collapsed and reopened', () => {
  const { bridge, render } = fixture(true);
  click(render(), 'Память');
  click(render(), 'Сохранить событие');
  expect(renderToStaticMarkup(render())).toContain('Подтвердить сохранение');
  click(render(), 'Память');
  expect(renderToStaticMarkup(render())).not.toContain('Подтвердить сохранение');
  click(render(), 'Память');
  expect(renderToStaticMarkup(render())).toContain('Подтвердить сохранение');
  expect(bridge.mutateMemoryCard).not.toHaveBeenCalled();
});

it('invalidates summary preview on conversation changes even while the panel is collapsed', async () => {
  const { bridge } = fixture();
  const client = getSummaryClient(bridge.summary);
  client.acceptIdentity('s', 'old');
  bridge.summary.preview.mockResolvedValue({ ok: true, value: { previewId: 'p', expiresAt: 120000,
    pairs: Array.from({ length: 4 }, () => ({ userText: 'u', assistantText: 'a' })) } });
  await client.preview();
  expect(client.getState().preview).not.toBeNull();
  expect(renderToStaticMarkup(<SummaryControls bridge={bridge.summary} visible={false}
    snapshot={{ streamId: 's', dialogue: { conversationId: 'new', canSubmit: true, turn: { phase: 'idle' } } }} />)).toBe('');
  for (const effect of hooks.effects) effect();
  expect(client.getState().preview).toBeNull();
  await client.confirm();
  expect(bridge.summary.confirm).not.toHaveBeenCalled();
});
