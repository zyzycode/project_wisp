import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { MemoryCards } from '../../src/renderer/components/Chat/MemoryCards';
import type { DialogueTurnPresentationDTO, MemoryCardListResultDTO, MemoryCardResultDTO } from '../../src/shared/ipc-contracts';
function render(turn: DialogueTurnPresentationDTO) {
  const bridge = { listMemoryCards: vi.fn(async (): Promise<MemoryCardListResultDTO> => ({ ok: true, generation: 0, items: [], nextCursor: null })),
    mutateMemoryCard: vi.fn(async (): Promise<MemoryCardResultDTO> => ({ ok: false, generation: 0, code: 'unavailable' })) };
  const markup = renderToStaticMarkup(<MemoryCards bridge={bridge} snapshot={{ streamId: 'stream', dialogue: { conversationId: 'c', canSubmit: true, turn } }} />);
  return { markup, bridge };
}
it('offers event/joke confirmation only when a successful turn has Main-issued source ids', () => {
  const turn = { phase: 'completed', requestId: 'r', replyText: 'Ответ', outcome: { kind: 'success' }, memorySource: { userMessageId: 'u', assistantMessageId: 'a' } } as const;
  const result = render(turn);
  expect(result.markup).toContain('Сохранить событие'); expect(result.markup).toContain('Сохранить шутку');
  expect(result.bridge.mutateMemoryCard).not.toHaveBeenCalled();
  for (const other of [{ phase: 'idle' } as const, { ...turn, memorySource: undefined }, { ...turn, outcome: { kind: 'fallback', reason: 'offline' } as const }]) {
    expect(render(other).markup).not.toContain('Сохранить событие');
  }
});
