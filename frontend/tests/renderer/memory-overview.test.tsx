import { Children, isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { MemoryOverview } from '../../src/renderer/components/Chat/MemoryOverview';
import { getMemoryOverviewClient } from '../../src/renderer/memory-overview-client';
import { recognizeMemoryFact } from '../../src/application/services/memory-fact-registry';
import type { ClearMemoryCommandDTO, ClearMemoryResultDTO, MemoryFactsResultDTO, MemoryStatusDTO } from '../../src/shared/ipc-contracts';
const hooks = vi.hoisted(() => ({ values: [] as unknown[], index: 0 }));
vi.mock('react', async importOriginal => ({ ...await importOriginal<typeof import('react')>(),
  useState: <T,>(initial: T) => { const index = hooks.index++; if (!(index in hooks.values)) hooks.values[index] = initial; return [hooks.values[index], (value: T) => { hooks.values[index] = value; }]; },
  useEffect: vi.fn(), useSyncExternalStore: (_subscribe: unknown, getState: () => unknown) => getState(),
}));
beforeEach(() => { hooks.values = []; hooks.index = 0; });
function fixture() {
  const bridge = {
    getMemoryStatus: vi.fn(async (): Promise<MemoryStatusDTO> => ({ mode: 'persistent', characterRestore: 'default' })),
    readMemoryFacts: vi.fn(async (): Promise<MemoryFactsResultDTO> => ({ ok: true, facts: [
      { key: 'user.display_name', value: 'Анна' }, { key: 'user.preferred_address', value: 'Аня' },
      { key: 'user.favorite_topic', value: 'музыка' }, { key: 'user.reply_style', value: 'brief' }, { key: 'user.cursor_game', value: 'dislike' },
    ] })),
    clearMemory: vi.fn(async (command: ClearMemoryCommandDTO): Promise<ClearMemoryResultDTO> => ({ requestId: command.requestId, status: 'cleared' })),
  };
  const client = getMemoryOverviewClient(bridge); client.acceptIdentity('s', 'c');
  const snapshot = { streamId: 's', dialogue: { conversationId: 'c', canSubmit: true, turn: { phase: 'idle' as const } } };
  const render = (visible = true, otherBusy = false) => { hooks.index = 0; return MemoryOverview({ bridge, snapshot, visible, otherBusy, children: <button type="button">Изменить карточку</button> }); };
  return { client, bridge, render };
}
function button(tree: ReactNode, label: string) {
  let found: { onClick?: () => void; disabled?: boolean } | undefined;
  function visit(nodes: ReactNode): void { Children.forEach(nodes, node => {
    if (!isValidElement<{ children?: ReactNode; onClick?: () => void; disabled?: boolean }>(node)) return;
    if (node.type === 'button' && node.props.children === label) found = node.props;
    else visit(node.props.children);
  }); }
  visit(tree); expect(found).toBeDefined(); return found!;
}
it('renders five facts only after success and distinguishes failure, initialization, and volatile storage', async () => {
  const { render, client, bridge } = fixture();
  expect(renderToStaticMarkup(render())).not.toContain('Не сохранено');
  await client.read(); let html = renderToStaticMarkup(render());
  for (const text of ['Анна', 'Аня', 'музыка', 'Краткие ответы', 'Не нравится']) expect(html).toContain(text);
  expect(html).not.toContain('user.display_name');
  bridge.readMemoryFacts.mockResolvedValue({ ok: true, facts: [] }); await client.read();
  expect(renderToStaticMarkup(render()).match(/Не сохранено/g)).toHaveLength(5);
  bridge.readMemoryFacts.mockResolvedValue({ ok: false, code: 'unavailable' }); await client.read();
  expect(renderToStaticMarkup(render())).not.toContain('Не сохранено');
  bridge.getMemoryStatus.mockResolvedValue({ mode: 'initializing' }); await client.read();
  expect(renderToStaticMarkup(render())).toContain('ещё загружается');
  bridge.getMemoryStatus.mockResolvedValue({ mode: 'volatile', reason: 'corrupt' }); await client.read(); html = renderToStaticMarkup(render());
  expect(html).toContain('Старые данные могут сохраниться'); expect(html).not.toContain('Не сохранено');
  expect(button(render(), 'Очистить всю локальную память').disabled).toBe(true);
});
it('shows registry-supported RU/EN corrections without sending any chat or reset command', async () => {
  const { render, client, bridge } = fixture(); await client.read();
  button(render(), 'Как исправить').onClick?.(); const html = renderToStaticMarkup(render());
  const phrases = [...html.matchAll(/<span lang="(?:ru|en)">([^<]+)<\/span>/g)].map(match => match[1]!);
  expect(phrases).toHaveLength(14);
  for (const phrase of phrases) expect(recognizeMemoryFact(phrase)).toBeDefined();
  expect(html).toContain('Ответ Wisp не подтверждает запись'); expect(bridge.clearMemory).not.toHaveBeenCalled();
});
it('requires confirmation, supports cancel/reopen, and locks sibling controls on unknown reset result', async () => {
  const { render, client, bridge } = fixture(); await client.read();
  button(render(), 'Очистить всю локальную память').onClick?.();
  let html = renderToStaticMarkup(render()); expect(html).toContain('Подтверждение полной очистки');
  expect(html).toContain('Это не удаляет данные'); expect(html).toContain('Авторская личность');
  expect(bridge.clearMemory).not.toHaveBeenCalled(); button(render(), 'Отмена').onClick?.();
  expect(renderToStaticMarkup(render())).not.toContain('Подтверждение полной очистки');
  button(render(), 'Очистить всю локальную память').onClick?.(); bridge.clearMemory.mockRejectedValueOnce(new Error());
  await client.clear(); html = renderToStaticMarkup(render());
  expect(html).toContain('<fieldset class="memory-actions" disabled=""');
  expect(html).toContain('Проверить ту же команду очистки'); expect(html).not.toContain('память очищена');
  expect(renderToStaticMarkup(render(false))).not.toContain('Очистка');
});
it('disables both destructive entry and confirm while another memory operation is pending', async () => {
  const { render, client } = fixture(); await client.read(); client.openConfirmation();
  expect(button(render(true, true), 'Очистить всю локальную память').disabled).toBe(true);
  expect(button(render(true, true), 'Удалить всю локальную память').disabled).toBe(true);
});
